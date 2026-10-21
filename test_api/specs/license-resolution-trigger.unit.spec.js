/* eslint-disable no-undef */
// Manual resolution of unmatched component licenses (frontend).
//
// Two kinds of assertion live here, for the same reason as
// component-details-license-init.frontend.unit.spec.js and
// component-multy-license.unit.spec.js:
//
//   1. REAL behavioural tests against the pure decision module
//      imports/client/ui/module/common/licenseResolution.js. That module is
//      deliberately plain CommonJS with no `meteor/*` imports, so the state
//      machine that decides WHICH of the four aside states renders (and the
//      justification validation the UI must enforce before it calls the
//      server) is genuinely executed here, not merely pattern-matched.
//
//   2. Source-text assertions on the Blaze templates. There is no
//      jsdom/Blaze/select2 harness in this repo, so "the picker is on screen",
//      "the heading is green", "focus moves into the textarea" cannot be
//      rendered and observed. Those criteria are locked in as invariants on
//      the markup/wiring so a refactor that drops them fails CI.
//
// Acceptance criteria covered: 1, 2, 3, 4, 9, 10, 12, 13, 18, 27.
const fs = require('fs');
const path = require('path');

const {
  resolutionState,
  resolutionView,
  findResolutionEntry,
  extractPathReason,
  collectPolicyStatuses,
  isJustificationValid,
  isStaleResolution,
  worstPolicyStatus,
  policyStatusWord,
  JUSTIFICATION_MAX_LENGTH
} = require('../../imports/client/ui/module/common/licenseResolution');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '../../', relative), 'utf8');
}

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const resolveHtml = read('imports/client/ui/module/common/component-license-resolve.html');
const resolveJs = stripComments(read('imports/client/ui/module/common/component-license-resolve.js'));
const catalogHtml = read('imports/client/ui/module/common/license-catalog-select.html');
const catalogJs = stripComments(read('imports/client/ui/module/common/license-catalog-select.js'));
const rootPickerHtml = read('imports/client/ui/module/common/root-component-license-picker.html');
const asideHtml = read('imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.html');
const asideJs = stripComments(
  read('imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.js')
);
const riskEditJs = stripComments(read('imports/client/ui/common/risk-edit/risk-edit.js'));
const riskEditHtml = read('imports/client/ui/common/risk-edit/risk-edit.html');

// --- The REAL stored analysis shape, evaluated out of the demo data ----------
//
// Both defects QA found (a reason read from `license.licenseStatus.reason`, a
// verdict read from `license.licenseStatus.computedStatus`) survived 6578 green
// tests because every test handed the decision functions a fixture that already
// carried the extracted values. A test that builds its own input in the shape
// the code expects proves nothing about the shape the database stores.
//
// So the fixture below is not typed out here: it is the actual object literal
// from imports/lib/demo/demoData.js, located and evaluated at test time. If the
// analysis document ever stops looking like this, these tests fail instead of
// quietly agreeing with the code.
const demoSource = read('imports/lib/demo/demoData.js');

// Balanced-bracket slice that skips quoted spans, so an apostrophe or a bracket
// inside a string cannot end the literal early.
function literalAt(source, fromIndex, openChar, closeChar) {
  const start = source.indexOf(openChar, fromIndex);
  if (start === -1) throw new Error('no ' + openChar + ' after index ' + fromIndex);
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'') quote = ch;
    else if (ch === openChar) depth++;
    else if (ch === closeChar && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced literal');
}

// `npm:format-as-currency` is the demo component whose single path carries a
// matched license the analyzer was not confident about - trigger state (b),
// which is the state the issue title describes and the one that never fired.
function storedDemoPaths() {
  // Anchored inside getDemoModuleAnalysis, NOT getDemoScan: the same component
  // key appears in the raw scan too, where a license is `{name: 'MIT'}` with no
  // status at all. The analysis document is what the aside renders from.
  const analysis = demoSource.indexOf('getDemoModuleAnalysis: function');
  if (analysis === -1) throw new Error('getDemoModuleAnalysis is gone from demoData.js');
  const anchor = demoSource.indexOf('\'key\': \'npm:format-as-currency\'', analysis);
  if (anchor === -1) throw new Error('npm:format-as-currency is gone from the demo analysis');
  const literal = literalAt(demoSource, demoSource.indexOf('\'paths\': [', anchor), '[', ']');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + literal)();
}

// The shape licenseResolutionContext hands the panel: the descriptor parked
// under `path`, with the reason already extracted beside it.
function contextPathsFrom(storedPaths) {
  return storedPaths.map(function (item) {
    return {
      licenseCount: (item.licenses || []).length,
      reason: extractPathReason(item.licenses),
      path: item
    };
  });
}

const RESOLVED_ENTRY = {
  key: 'npm:left-pad',
  license: 'MIT',
  justification: 'Upstream README states MIT; checked the tarball.',
  resolvedBy: 'Ada Lovelace',
  resolvedById: 'uid1',
  resolvedAt: new Date('2026-09-09T10:00:00Z')
};

// An entry written by the multi-license modal / root picker: no justification.
const FOREIGN_ENTRY = {
  key: 'npm:left-pad',
  license: 'Apache-2.0',
  comment: 'Root component license picked by someone, 01/01/2026'
};

describe('#139 AC1 - a path with no licenses at all offers the picker', () => {
  it('reports unmatched-no-license for a single path carrying zero licenses', () => {
    expect(resolutionState({componentKey: 'npm:left-pad', licenseCount: 0}, [])).toBe('unmatched-no-license');
  });

  it('reports unmatched-no-license when ANY version/path of the component has none', () => {
    const ctx = {
      componentKey: 'npm:left-pad',
      paths: [
        {licenseCount: 1, reason: ''},
        {licenseCount: 0, reason: ''}
      ]
    };
    expect(resolutionState(ctx, [])).toBe('unmatched-no-license');
  });

  it('treats a missing licenseCount as "no licenses" rather than throwing', () => {
    expect(resolutionState({componentKey: 'npm:left-pad'}, [])).toBe('unmatched-no-license');
  });
});

// The stored field is `status.reason`. The AC text says "licenseStatus.reason",
// which is the name of a Blaze helper, not of a field - and taking that name
// literally is exactly what made this trigger state dead.
describe('#139 AC2 - a non-empty status.reason offers the same control', () => {
  it('reports unmatched-reason when a license exists but the analyzer is unsure', () => {
    const ctx = {componentKey: 'npm:left-pad', licenseCount: 1, reason: 'License could not be matched correctly'};
    expect(resolutionState(ctx, [])).toBe('unmatched-reason');
  });

  it('ignores a whitespace-only reason (that is not a real reason)', () => {
    const ctx = {componentKey: 'npm:left-pad', licenseCount: 1, reason: '   '};
    expect(resolutionState(ctx, [])).toBe('none');
  });

  it('prefers the no-license state when one path has none and another has a reason', () => {
    const ctx = {
      componentKey: 'npm:left-pad',
      paths: [
        {licenseCount: 1, reason: 'not confident'},
        {licenseCount: 0, reason: ''}
      ]
    };
    expect(resolutionState(ctx, [])).toBe('unmatched-no-license');
  });
});

describe('#139 AC3 - a matched license with no reason gets NO control', () => {
  it('reports none for a clean single-license path', () => {
    expect(resolutionState({componentKey: 'npm:left-pad', licenseCount: 1, reason: ''}, [])).toBe('none');
  });

  it('reports none for a clean multi-license path (the multi-license modal owns that)', () => {
    const ctx = {
      componentKey: 'npm:left-pad',
      paths: [{licenseCount: 3, reason: ''}, {licenseCount: 2, reason: ''}]
    };
    expect(resolutionState(ctx, [])).toBe('none');
  });

  it('reports none when there is no component key to resolve against', () => {
    expect(resolutionState({licenseCount: 0}, [])).toBe('none');
    expect(resolutionState(null, [])).toBe('none');
  });

  it('leaves the multi-license trigger in the aside untouched', () => {
    expect(asideHtml).toContain('componentMultyLicense');
    expect(asideHtml).toContain('moreThanOneLicense getVersionLicenses');
  });
});

describe('#139 AC4 - every account type can use the control', () => {
  it('does not wrap the shared catalogue select in an account-type gate', () => {
    expect(catalogHtml).not.toContain('isPrivateLicensesAccount');
  });

  it('offers the private-licenses optgroup to every account, only hiding it when empty', () => {
    const optgroup = catalogHtml.match(/\{\{#if hasPrivateLicenses\}\}[\s\S]*?\{\{\/if\}\}/);
    expect(optgroup).not.toBeNull();
    expect(optgroup[0]).toContain('Private licenses');
    expect(catalogJs).not.toMatch(/accountType\s*===\s*'enterprise'/);
  });

  it('does not gate the resolve section on the account type anywhere', () => {
    expect(resolveHtml).not.toContain('isPrivateLicensesAccount');
    expect(resolveJs).not.toContain('isPrivateLicensesAccount');
  });

  it('keeps the root picker template as a thin wrapper around the shared select', () => {
    expect(rootPickerHtml).toContain('licenseCatalogSelect');
    // The forked copy must be gone, or the two controls drift apart again.
    expect(rootPickerHtml).not.toContain('rootComponentLicensePickerSelect');
  });
});

describe('#139 AC9 - an empty justification is blocked in the UI', () => {
  it('rejects empty, whitespace-only and non-string justifications', () => {
    expect(isJustificationValid('')).toBe(false);
    expect(isJustificationValid('   \n\t ')).toBe(false);
    expect(isJustificationValid(undefined)).toBe(false);
    expect(isJustificationValid(null)).toBe(false);
    expect(isJustificationValid(42)).toBe(false);
  });

  it('accepts a one-character justification once trimmed', () => {
    expect(isJustificationValid(' x ')).toBe(true);
  });

  it('mirrors the server cap of 2000 raw characters', () => {
    expect(JUSTIFICATION_MAX_LENGTH).toBe(2000);
    expect(isJustificationValid('a'.repeat(2000))).toBe(true);
    expect(isJustificationValid('a'.repeat(2001))).toBe(false);
    // The cap is on the RAW string, exactly as the server measures it.
    expect(isJustificationValid(' ' + 'a'.repeat(2000))).toBe(false);
  });

  it('warns instead of calling the server when the textarea is empty', () => {
    expect(resolveJs).toContain('Please explain why this license applies before you set it.');
    const warnIndex = resolveJs.indexOf('Please explain why this license applies before you set it.');
    const callIndex = resolveJs.indexOf('Modules.ResolveComponentLicense');
    expect(warnIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(-1);
    // The guard is wired through the shared validator, not re-implemented.
    expect(resolveJs).toContain('isJustificationValid');
  });

  it('states the cap the server actually enforces (2000 is valid)', () => {
    // resolutionEntry.js rejects only `> 2000`, so "under 2000" names a limit
    // that does not exist.
    expect(resolveJs).toContain('The justification is too long - please use 2000 characters or fewer.');
    expect(resolveJs).not.toContain('keep it under 2000 characters');
  });
});

describe('#139 - the blast-radius sentence agrees with itself in every case', () => {
  // The commonest component of all appears once, at one version. Unpluralised
  // counts render "1 paths across 1 versions" there - in the modal a compliance
  // manager has to read before committing an audit record.
  const builder = resolveJs.match(/function buildConfirmationHtml\([\s\S]*?\n\}/);

  it('pluralises BOTH counts in the confirmation dialog', () => {
    expect(builder).not.toBeNull();
    expect(builder[0]).toMatch(/safePathCount === '1' \? 'path' : 'paths'/);
    expect(builder[0]).toMatch(/safeVersionCount === '1' \? 'version' : 'versions'/);
    // ...and neither noun is left hardcoded in the sentence itself.
    expect(builder[0]).not.toMatch(/\+ ' paths, across '/);
    expect(builder[0]).not.toContain(" versions - not only");
  });

  it('pluralises the inline hint through a helper, with no second branch', () => {
    expect(resolveJs).toMatch(/pathWord:\s*function[\s\S]{0,120}\? 'path' : 'paths'/);
    expect(resolveHtml).toContain('{{pathCount}} {{pathWord}}');
    // `isSinglePath` guarded pathCount only and left versionCount unpluralised;
    // the single sentence replaces both branches.
    expect(resolveHtml).not.toContain('isSinglePath');
    expect(resolveJs).not.toContain('isSinglePath');
    expect(resolveHtml).not.toContain('{{versionCount}} versions');
  });
});

describe('#139 - the special-case explanations do not contradict the catalogue', () => {
  it('sends a named public-domain dedication back to its own identifier', () => {
    // CC0-1.0 and Unlicense are seeded catalogue entries offered in this very
    // select; recording PUBLIC-DOMAIN instead erases the SPDX identifier from
    // the component's SBOM and Notice output permanently.
    expect(catalogJs).toContain(
      'If the dedication is a named license such as CC0-1.0 or the Unlicense, pick that instead.'
    );
    expect(catalogJs).not.toContain('for example a CC0 dedication, the Unlicense');
  });

  it('scopes the NO-LICENSE / UNKNOWN distinction to one reading', () => {
    expect(catalogJs).toContain(
      'If you looked and still cannot tell, pick "UNKNOWN" instead.'
    );
    // The dropdown lists KEYS, so the cross-reference must name the key.
    expect(catalogJs).not.toContain('that is "Unknown"');
  });

  it('prefers "rights holder" to "author" - an author may have assigned rights', () => {
    const copy = catalogJs.slice(catalogJs.indexOf('EDGE_CASE_HINTS'),
      catalogJs.indexOf('function hintFor'));
    expect(copy).toContain('rights holder');
    expect(copy).not.toMatch(/\bauthor\b/);
  });
});

describe('#139 AC10 - the record shows justification, author and date', () => {
  it('projects the stored entry onto the four display fields', () => {
    const view = resolutionView(RESOLVED_ENTRY);
    expect(view.license).toBe('MIT');
    expect(view.justification).toBe('Upstream README states MIT; checked the tarball.');
    expect(view.author).toBe('Ada Lovelace');
    expect(view.date).toBeTruthy();
  });

  it('returns null for an entry that carries no justification (not ours)', () => {
    expect(resolutionView(FOREIGN_ENTRY)).toBeNull();
    expect(resolutionView(null)).toBeNull();
  });

  it('never shows one component the justification recorded for another', () => {
    const list = [
      Object.assign({}, RESOLVED_ENTRY, {key: 'npm:a', justification: 'reason for A'}),
      Object.assign({}, RESOLVED_ENTRY, {key: 'npm:b', justification: 'reason for B'})
    ];
    expect(findResolutionEntry(list, 'npm:a').justification).toBe('reason for A');
    expect(findResolutionEntry(list, 'npm:b').justification).toBe('reason for B');
    expect(findResolutionEntry(list, 'npm:c')).toBeNull();
  });

  it('ignores multi-license / root-picker entries for the same component key', () => {
    expect(findResolutionEntry([FOREIGN_ENTRY], 'npm:left-pad')).toBeNull();
    expect(findResolutionEntry([{key: 'npm:left-pad', license: 'MIT', justification: '   '}], 'npm:left-pad')).toBeNull();
  });

  it('handles a missing or malformed licensesSelected array', () => {
    expect(findResolutionEntry(undefined, 'npm:a')).toBeNull();
    expect(findResolutionEntry([null, undefined, 7], 'npm:a')).toBeNull();
  });
});

describe('#139 AC12 - the green record replaces the yellow block', () => {
  it('reports resolved once an entry with a justification exists, whatever the paths say', () => {
    const ctx = {componentKey: 'npm:left-pad', paths: [{licenseCount: 0, reason: ''}]};
    expect(resolutionState(ctx, [RESOLVED_ENTRY])).toBe('resolved');
  });

  it('stays unresolved when only a foreign entry exists for that key', () => {
    const ctx = {componentKey: 'npm:left-pad', paths: [{licenseCount: 0, reason: ''}]};
    expect(resolutionState(ctx, [FOREIGN_ENTRY])).toBe('unmatched-no-license');
  });

  it('uses the agreed heading copy and the user-pen icon, never a check mark', () => {
    expect(resolveHtml).toContain('License set manually');
    expect(resolveHtml).toContain('fa-user-pen');
    expect(resolveHtml).not.toContain('fa-check');
  });

  it('never calls the manual record "Resolved" (that word means accepted risk here)', () => {
    // The aside already uses "Resolved" for accepted legal-rule risk; reusing it
    // would tell a compliance manager they accepted a risk they did not accept.
    expect(resolveHtml).not.toMatch(/\bResolved\b/);
    expect(resolveHtml).not.toMatch(/\bresolved\b(?![-\w])/);
  });
});

describe('#139 AC13 - a denylisted pick still reads as a violation', () => {
  it('shows the policy verdict as a word, in its own live region', () => {
    expect(resolveHtml).toContain('Policy status');
    expect(resolveHtml).toContain('aria-live="polite"');
  });

  it('carries the verdict colour on a decorative dot, never on the text', () => {
    expect(resolveHtml).toContain('module-aside-status-dot');
    expect(resolveHtml).toMatch(/module-aside-status-dot bg-\{\{/);
    expect(resolveHtml).toMatch(/module-aside-status-dot[^>]*aria-hidden="true"/);
  });

  it('avoids ecsLabel, whose warning/ok colours fail contrast', () => {
    expect(resolveHtml).not.toContain('ecsLabel');
  });

  it('says in words that policy, not this record, decides whether the license is allowed', () => {
    expect(resolveHtml).toContain(
      'Setting a license records which license applies. Whether it is allowed is decided by your company policy'
    );
  });

  it('says the same thing in future tense in the confirmation dialog', () => {
    expect(resolveJs).toContain(
      'this component may still be reported as a warning or a violation'
    );
  });

  it('shows Pending, not an invented verdict, before the next analysis run', () => {
    expect(worstPolicyStatus([])).toBe('pending');
    expect(policyStatusWord('pending')).toBe('Pending');
    // The save auto-fires Modules.PropagateLicensePicks and toasts
    // "Re-analysing…", so the hint must NOT tell the user to start an analysis
    // that is already running - only what to do if it never reports back.
    expect(resolveHtml).toContain(
      'The analysis is running. This line updates when it reports back; if it stays Pending, ' +
      'run Analyse in the module header.'
    );
    expect(resolveHtml).not.toContain('Run Analyse in the module header to evaluate');
  });

  it('reports the analyzer verdict verbatim once it exists, worst path first', () => {
    expect(worstPolicyStatus(['ok'])).toBe('ok');
    expect(worstPolicyStatus(['ok', 'warnings'])).toBe('warnings');
    expect(worstPolicyStatus(['ok', 'warnings', 'violations'])).toBe('violations');
    // A denylisted pick must surface as Violations, not be softened to OK.
    expect(worstPolicyStatus(['violations', 'ok'])).toBe('violations');
  });

  it('ignores statuses the analyzer does not define rather than guessing', () => {
    expect(worstPolicyStatus(['', null, undefined, 'disabled'])).toBe('pending');
    expect(worstPolicyStatus(null)).toBe('pending');
  });

  it('always has a word for every status it can produce', () => {
    // Singular, matching the status dropdown in the same aside
    // (module-dependencies-aside.html: OK / Warning / Violation).
    expect(policyStatusWord('ok')).toBe('OK');
    expect(policyStatusWord('warnings')).toBe('Warning');
    expect(policyStatusWord('violations')).toBe('Violation');
    expect(policyStatusWord('nonsense')).toBe('Pending');
  });

  it('uses the same status words as the status dropdown beside it', () => {
    const dropdown = asideHtml.slice(asideHtml.indexOf('{{#if isSetStatus}}'));
    ['ok', 'warnings', 'violations'].forEach(function (status) {
      expect(dropdown).toContain('value="' + status + '"');
      expect(dropdown).toContain('>' + policyStatusWord(status) + '<');
    });
  });
});

describe('#139 AC18 - undo returns the component to the yellow state', () => {
  it('reports the unmatched state again once the entry is gone', () => {
    const ctx = {componentKey: 'npm:left-pad', paths: [{licenseCount: 0, reason: ''}]};
    expect(resolutionState(ctx, [RESOLVED_ENTRY])).toBe('resolved');
    expect(resolutionState(ctx, [])).toBe('unmatched-no-license');
  });

  it('calls the clear method and warns that the audit record is destroyed', () => {
    expect(resolveJs).toContain('Modules.ClearComponentLicenseResolution');
    expect(resolveJs).toContain('Clear the manual license?');
    expect(resolveJs).toContain('#cf4747');
  });

  it('promises nothing about a risk entry the company cannot have', () => {
    // The green panel gates its risk line on `risks` + a project; the dialog
    // must use the SAME gate, or it names a screen the user cannot open.
    expect(resolveJs).toContain(
      'Any risk entry created for it stays in Risk management - remove it there if it no longer applies.'
    );
    expect(resolveJs).not.toContain('The risk entry in Risk management is not deleted.');
    expect(resolveJs).toMatch(/riskLineApplies\(data\.moduleId\)\s*\?/);
    // One gate, read by both surfaces - not two copies that can drift.
    expect(resolveJs).toMatch(/showRiskLine:\s*function[\s\S]{0,120}riskLineApplies\(/);
  });

  it('exposes the undo control as a real button with a tooltip AND screen-reader text', () => {
    expect(resolveHtml).toMatch(/<button[^>]*type="button"[^>]*clear-component-license/);
    expect(resolveHtml).toMatch(/class="sr-only"/);
    // BOTH, carrying IDENTICAL text. NVDA and JAWS suppress a `title` that
    // equals the accessible name, so duplicate text is the configuration that
    // cannot double-announce - and this button destroys an audit record, which
    // is the wrong place for a sighted mouse user to lose the tooltip.
    expect(resolveHtml).toContain('title="Clear the manually set license"');
    expect(resolveHtml).toContain('<span class="sr-only">Clear the manually set license</span>');
  });
});

describe('#139 - stale resolution (the analysis ran and still reports no license)', () => {
  const analysedAfter = new Date('2026-09-09T12:00:00Z');
  const analysedBefore = new Date('2026-09-09T08:00:00Z');

  it('flags a resolution the later analysis did not pick up', () => {
    expect(isStaleResolution(RESOLVED_ENTRY, analysedAfter, false)).toBe(true);
  });

  it('does not flag it when the analysis did pick a license up', () => {
    expect(isStaleResolution(RESOLVED_ENTRY, analysedAfter, true)).toBe(false);
  });

  it('does not flag it before the next analysis has run', () => {
    expect(isStaleResolution(RESOLVED_ENTRY, analysedBefore, false)).toBe(false);
    expect(isStaleResolution(RESOLVED_ENTRY, null, false)).toBe(false);
  });

  it('never flags an entry that is not ours', () => {
    expect(isStaleResolution(FOREIGN_ENTRY, analysedAfter, false)).toBe(false);
    expect(isStaleResolution(null, analysedAfter, false)).toBe(false);
  });

  it('renders the failure instead of swallowing it', () => {
    expect(resolveHtml).toContain('Not applied');
    expect(resolveHtml).toContain('bot-violations');
    expect(resolveHtml).toContain('The manual selection was not picked up');
  });
});

describe('#139 - the write path matches the frozen interface contract', () => {
  it('calls ResolveComponentLicense with the four contract arguments', () => {
    expect(resolveJs).toMatch(
      /Modules\.ResolveComponentLicense'\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+/
    );
  });

  it('auto-fires the propagate call, but only when something actually changed', () => {
    expect(resolveJs).toContain('Modules.PropagateLicensePicks');
    expect(resolveJs).toMatch(/if\s*\(\s*!res\.changed\s*\)\s*return/);
  });

  it('re-renders from the reactive module document, not from the method response', () => {
    // The contract deliberately does not echo justification/author/date.
    expect(resolveJs).not.toMatch(/res\.(justification|resolvedBy|resolvedAt)/);
    expect(resolveJs).toContain('componentConfig');
  });

  it('mirrors the server length limits before calling', () => {
    expect(resolveJs).toContain('JUSTIFICATION_MAX_LENGTH');
  });
});

describe('#139 - role gate admits BOTH compliance_manager and manager', () => {
  it('does not repeat the add_legal_rule_resolved manager-only bug', () => {
    const gate = resolveJs.match(/userIsInRole\([^)]*\)/g) || [];
    expect(gate.length).toBeGreaterThan(0);
    gate.forEach(function (call) {
      expect(call).toContain('compliance_manager');
      expect(call).toContain('manager');
    });
  });

  it('uses its own grammatical not-allowed message, not the shared broken one', () => {
    expect(resolveJs).toContain('You are not allowed to set licenses in this module.');
    expect(resolveJs).not.toContain('You are not allowed to change this settings!');
  });
});

describe('#139 - accessibility invariants', () => {
  it('uses real buttons, never a bare <a class="btn"> with no href', () => {
    expect(resolveHtml).toMatch(/<button[^>]*type="button"[^>]*clear-component-license/);
    expect(resolveHtml).not.toMatch(/<a\s+class="btn/);
    // A bare href renders href="" and reloads the SPA.
    expect(resolveHtml).not.toMatch(/<a\s[^>]*\shref(?![=\w])/);
  });

  it('labels the select with the very id it hands to the shared control', () => {
    // Composed in JS because Blaze inclusion arguments take one expression,
    // so the label and the <select> must read the SAME helper or they drift.
    expect(resolveHtml).toMatch(/<label[^>]*for="\{\{selectId\}\}"/);
    expect(resolveHtml).toMatch(/\{\{>\s*licenseCatalogSelect[^}]*selectId=selectId/);
    expect(resolveJs).toContain('\'licenseResolve-\'');
  });

  it('labels the justification textarea', () => {
    expect(resolveJs).toContain('Why does this license apply? (required)');
    expect(resolveJs).toMatch(/<label[^>]*for=\\?'?"?confirmationText/);
  });

  it('keeps the shared confirmationText id/class/rows contract', () => {
    // Every other confirmation in this aside reads back
    // document.getElementById('confirmationText').value; the attribute quoting
    // inside the JS string is free, the id and the class/rows are not.
    expect(resolveJs).toMatch(/id=\\?['"]confirmationText\\?['"]/);
    expect(resolveJs).toContain('form-control inner-t-5');
    expect(resolveJs).toContain('rows="6"');
  });

  it('moves focus deliberately and never leaves it on document.body', () => {
    expect(resolveJs).toContain('confirmationText');
    expect(resolveJs).toMatch(/\.focus\(\)/);
    expect(resolveJs).toContain('Tracker.afterFlush');
    expect(resolveHtml).toContain('tabindex="-1"');
  });

  it('hides every decorative icon from assistive technology', () => {
    const icons = resolveHtml.match(/<span class="fa[^"]*"[^>]*>/g) || [];
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach(function (icon) {
      expect(icon).toContain('aria-hidden="true"');
    });
  });

  it('never disables the focus ring on the new controls', () => {
    const less = read('imports/client/stylesheets/module/module.import.less');
    const block = less.slice(less.indexOf('component-license-resolve'));
    expect(block).not.toContain('outline: none');
  });
});

describe('#139 - escaping of scan-controlled text in the swal body', () => {
  // Component names, license names and path strings all come out of scans and
  // are attacker-controlled; the dialog is rendered with swal `html: true`.
  // Building the body in ONE named function makes that splice auditable.
  const builder = resolveJs.match(/function buildConfirmationHtml\([\s\S]*?\n\}/);

  it('builds the html:true dialog body in a single auditable function', () => {
    expect(builder).not.toBeNull();
    expect(resolveJs).toContain('escapeHtml');
  });

  it('interpolates nothing that has not been escaped first', () => {
    const names = (builder[0].match(/\+\s*([A-Za-z_$][\w$]*)/g) || [])
      .map(function (piece) { return piece.replace(/^\+\s*/, ''); });
    expect(names.length).toBeGreaterThan(0);
    names.forEach(function (name) {
      expect(name).toMatch(/^safe/);
    });
  });

  it('renders the path preview through the existing formatPath output', () => {
    expect(resolveJs).toContain('formatPath');
    expect(resolveJs).toContain('max-height: 96px');
  });

  it('warns about UNKNOWN before the user commits to it', () => {
    expect(resolveJs).toContain(
      '"UNKNOWN" records that you investigated and could not determine the license.'
    );
  });

  it('never promises an analyzer verdict this app does not control (R1)', () => {
    // The constraints -> status mapping lives in the deployed ts-analysis
    // Lambda. Naming a verdict here would contradict the Policy status line a
    // few lines below whenever the hypothesis is wrong.
    expect(resolveJs).toContain('your policy still decides how it is reported');
    expect(resolveJs).not.toContain('will still be reported as a warning');
    expect(catalogJs).toContain('it does not clear the component');
    expect(catalogJs).not.toContain('the component stays a warning');
  });
});

describe('#139 - saving state disables the select as well as the overlay', () => {
  // Both are required: `action-in-progress` paints an overlay over the section,
  // but select2 appends its dropdown to <body>, outside that overlay.
  it('paints the overlay and hands the saving flag to the select', () => {
    expect(resolveJs).toContain('action-in-progress');
    expect(resolveHtml).toMatch(/\{\{>\s*licenseCatalogSelect[^}]*disabled=isSaving/);
  });

  it('really disables the underlying control, and tells select2 about it', () => {
    expect(catalogJs).toMatch(/prop\('disabled',\s*disabled\)/);
    expect(catalogJs).toContain('change.select2');
  });

  // Requested live: picking a license applies it, with no second click. The
  // dialog is still the commit point, so nothing is written without a
  // justification - the button only sat between the choice and the question.
  it('opens the confirmation from the picker itself, with no apply button', () => {
    expect(resolveHtml).not.toContain('set-component-license');
    expect(resolveJs).toMatch(/'change \.license-catalog-select':/);
    const handler = resolveJs.slice(resolveJs.indexOf("'change .license-catalog-select':"));
    expect(handler).toContain('openSetLicenseDialog(instance, event.target)');
    // An empty pick must NOT open it, or clearing the select would nag.
    expect(handler).toContain('if (!chosen) return;');
  });

  // Without this the picker keeps showing the abandoned choice, and re-picking
  // that same license fires no `change` - so the dialog can never be reopened.
  it('resets the picker on every non-success path', () => {
    const dialog = resolveJs.slice(resolveJs.indexOf('function openSetLicenseDialog'));
    const resets = dialog.match(/instance\.draftLicense\.set\(''\)/g) || [];
    expect(resets.length).toBeGreaterThanOrEqual(4); // cancel, invalid, success, failure
  });
});

describe('#139 - the edge-case optgroup', () => {
  it('imports the catch-all key list from the shared module instead of forking it', () => {
    expect(catalogJs).toMatch(
      /from\s+'\/imports\/lib\/licenseResolution\/catchAllLicenses'/
    );
    expect(catalogJs).not.toMatch(/'PUBLIC-DOMAIN'\s*,\s*'UNKNOWN'/);
  });

  it('pins the special cases into their own first optgroup', () => {
    expect(catalogHtml).toContain('Special cases - use only when no named license applies');
    expect(catalogHtml).toContain('edgeCaseOptions');
  });

  it('excludes those keys from the standard group so they are not listed twice', () => {
    expect(catalogJs).toContain('isCatchAllLicense');
    expect(catalogJs).toMatch(/sort:\s*\{key:\s*1\}/);
  });

  it('reads its props off the template instance, not the {{#each}} row', () => {
    // Inside the option loops Template.currentData() is the option row, which
    // never carries `value` - so `isCurrent` would silently never match and no
    // <option selected> would ever be emitted.
    const helpers = catalogJs.slice(catalogJs.indexOf('Template.licenseCatalogSelect.helpers'));
    expect(helpers).not.toContain('Template.currentData');
    expect(catalogJs).toMatch(/function props\(\)\s*\{\s*return Template\.instance\(\)\.data/);
    expect(helpers).toMatch(/isCurrent:\s*function\s*\(key\)\s*\{\s*return props\(\)\.value === key;/);
  });

  it('keeps the closed field short and the dropdown inside the viewport', () => {
    expect(catalogJs).toContain('templateResult');
    expect(catalogJs).toContain('templateSelection');
    expect(catalogJs).toContain('dropdownAutoWidth');
    expect(catalogJs).toContain('license-catalog-dropdown');
  });
});

describe('#139 - the aside renders the section once per component, not once per path', () => {
  it('inserts the component-level section between Details and the root picker', () => {
    const detailsIndex = asideHtml.indexOf('data-id="aside-details"');
    const resolveIndex = asideHtml.indexOf('componentLicenseResolve');
    const rootPickerIndex = asideHtml.indexOf('rootComponentLicensePicker');
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(detailsIndex);
    expect(resolveIndex).toBeLessThan(rootPickerIndex);
  });

  it('stands the section down when the root picker already owns the component', () => {
    expect(asideHtml).toContain('rootPickerOwnsComponent');
    expect(asideJs).toContain('rootPickerOwnsComponent');
  });

  it('gives the section the data-id the Licenses jump link targets', () => {
    const section = asideHtml.match(/<div class="aside-section[^"]*"[^>]*data-id="aside-legal"[^>]*>\s*\{\{>\s*componentLicenseResolve/);
    expect(section).not.toBeNull();
  });

  it('exposes the context through one helper rather than N per-path helpers', () => {
    expect(asideJs).toContain('licenseResolutionContext');
    expect(asideJs).toContain('resolutionState');
  });
});

describe('#139 - the per-path blocks lose the dead end but keep analyzer output', () => {
  it('replaces the hardcoded dead-end string', () => {
    expect(asideHtml).not.toContain('License could not be matched correctly');
    expect(asideHtml).toContain('No license statement was found for this path.');
  });

  it('points at the component-level control instead of repeating it', () => {
    expect(asideHtml).toContain('Set the license for this component');
    expect(asideHtml).toMatch(/scroll-to[^>]*data-target="aside-legal"/);
  });

  it('still prints the analyzer reason verbatim', () => {
    expect(asideHtml).toContain('{{licenseStatus.reason}}');
  });

  // The read-only variant belongs to the component-level section, not the
  // per-path block: like the control it replaces, it is offered once per
  // component, not once per path per version.
  it('offers read-only roles a comment action instead of a dead end', () => {
    expect(resolveHtml).toContain('License not set');
    // It renders in the unmatched-reason state too, where the analysis DID
    // match a license, so it must not claim the scan determined nothing; and it
    // must not read as an exclusive role list, since `manager` also qualifies.
    expect(resolveHtml).toContain(
      'The license for this component has to be set by hand. Ask a compliance manager to set it.'
    );
    expect(resolveHtml).not.toContain('Only a compliance manager can set it.');
    expect(resolveHtml).toMatch(/<button[^>]*data-target="aside-comment"[^>]*>\s*Add a comment/);
  });
});

describe('#139 - one vocabulary across the feature', () => {
  it('says "analysis", never "analyzer", in copy the user reads', () => {
    // The sibling aside uses "analysis" exclusively; "analyzer" is our internal
    // name for the ts-analysis Lambda and must not leak into the panel.
    const copy = resolveHtml.replace(/<!--[\s\S]*?-->/g, '');
    expect(copy).not.toMatch(/analyz/i);
    expect(copy).toContain('The analysis matched a license for this component but was not confident about it.');
  });

  it('quotes the license key in the toast, like the root picker beside it', () => {
    const picker = stripComments(read('imports/client/ui/module/common/root-component-license-picker.js'));
    expect(picker).toContain('license set to "\' + newLicense + \'". Re-analysing…');
    expect(resolveJs).toContain('License set to "\' + chosen + \'". Re-analysing…');
  });

  it('sticks to "set ... to" and "cleared" on every surface', () => {
    expect(resolveJs).toContain('Manual license cleared.');
    expect(asideHtml).toContain('Set manually to {{pathResolutionKey}}.');
  });
});

describe('#139 - the risk line is derived, not stored', () => {
  it('renders it from the module project, with no riskId field and no feature flag', () => {
    // The Community Edition has one tier: every company has every feature, so
    // the risk line no longer reads a company licence at all - only whether the
    // module belongs to a project.
    expect(resolveJs).not.toContain('allowedLicenses');
    expect(resolveJs).toContain('projectId');
    expect(resolveJs).not.toContain('riskId');
    expect(resolveHtml).toContain('A risk entry was created in');
  });
});

describe('#139 - dark theme overrides exist for the new hint classes', () => {
  const dark = read('imports/client/stylesheets/themes/dark.import.less');

  it('overrides the hint colour (the light #6b7280 fails on #292929)', () => {
    expect(dark).toContain('license-resolve-hint');
    expect(dark).toContain('@color-text-muted-dark');
  });

  it('does not lean on Bootstrap .text-muted for the hint (3.2:1)', () => {
    const hintTags = resolveHtml.match(/class="[^"]*license-resolve-hint[^"]*"/g) || [];
    expect(hintTags.length).toBeGreaterThan(0);
    hintTags.forEach(function (tag) {
      expect(tag).not.toContain('text-muted');
    });
  });
});

describe('#139 D1 - the analyzer reason is read from the field the database stores', () => {
  it('found a real demo path carrying a real reason (control, so nothing below is vacuous)', () => {
    const stored = storedDemoPaths();
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0].licenses[0].key).toBe('CC-BY-4.0');
    expect(stored[0].licenses[0].status.reason).toBe('License could not be matched correctly');
  });

  it('the stored license entry has no licenseStatus field at all', () => {
    // `licenseStatus` is a Blaze HELPER in module-dependencies-aside.js - it
    // returns `status` decorated with the policy-adjusted `computedStatus`. It
    // is not, and never was, a field of the analysis document.
    const license = storedDemoPaths()[0].licenses[0];
    expect(Object.prototype.hasOwnProperty.call(license, 'status')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(license, 'licenseStatus')).toBe(false);
    expect(demoSource).not.toContain('licenseStatus');
  });

  it('extracts the reason from that real stored licenses array', () => {
    expect(extractPathReason(storedDemoPaths()[0].licenses)).toBe('License could not be matched correctly');
  });

  it('reproduces the defect: reading it off licenseStatus yields nothing', () => {
    const wrong = storedDemoPaths()[0].licenses.map(function (license) {
      return (license.licenseStatus && license.licenseStatus.reason) || '';
    }).join('');
    expect(wrong).toBe('');
    // ...and an empty reason is exactly what made resolutionState answer 'none',
    // which made licenseResolutionContext return null and the section vanish.
    expect(resolutionState({componentKey: 'npm:format-as-currency', licenseCount: 1, reason: wrong}, []))
      .toBe('none');
  });

  it('AC2 - the real stored path drives resolutionState to unmatched-reason', () => {
    const ctx = {componentKey: 'npm:format-as-currency', paths: contextPathsFrom(storedDemoPaths())};
    expect(resolutionState(ctx, [])).toBe('unmatched-reason');
  });

  it('returns no reason for shapes that carry none, instead of throwing', () => {
    expect(extractPathReason(null)).toBe('');
    expect(extractPathReason([])).toBe('');
    expect(extractPathReason([null, undefined])).toBe('');
    expect(extractPathReason([{key: 'MIT'}])).toBe('');
    expect(extractPathReason([{key: 'MIT', status: {status: 'ok'}}])).toBe('');
    expect(extractPathReason([{key: 'MIT', status: {reason: '   '}}])).toBe('');
  });

  it('takes the first real reason when several licenses sit on one path', () => {
    expect(extractPathReason([
      {key: 'MIT', status: {status: 'ok'}},
      {key: 'GPL-3.0', status: {status: 'warnings', reason: 'second'}},
      {key: 'BSD-3-Clause', status: {reason: 'third'}}
    ])).toBe('second');
  });

  it('the aside builds its context through the shared extractor', () => {
    expect(asideJs).toMatch(/reason:\s*extractPathReason\(licenses\)/);
    // The whole defect in one assertion: no field read off the helper name.
    expect(asideJs).not.toMatch(/license\.licenseStatus/);
  });
});

describe('#139 D2 - the policy verdict is collected from the field the database stores', () => {
  function denylist() {
    return {status: 'violations', label: 'Blacklisted by company'};
  }

  it('collects nothing while no verdict exists, so the line reads Pending honestly', () => {
    const statuses = collectPolicyStatuses(contextPathsFrom(storedDemoPaths()), 'CC-BY-4.0');
    expect(statuses).toEqual([]);
    expect(policyStatusWord(worstPolicyStatus(statuses))).toBe('Pending');
  });

  it('AC13 - a denylisted license reads Violation, never green and never Pending', () => {
    const statuses = collectPolicyStatuses(contextPathsFrom(storedDemoPaths()), 'CC-BY-4.0', denylist);
    expect(statuses).toEqual(['violations']);
    expect(worstPolicyStatus(statuses)).toBe('violations');
    expect(policyStatusWord(worstPolicyStatus(statuses))).toBe('Violation');
  });

  it('prefers a verdict the dependency aside already wrote onto the shared status object', () => {
    const paths = contextPathsFrom(storedDemoPaths());
    paths[0].path.licenses[0].status.computedStatus = {status: 'warnings', label: 'Warnings'};
    // The injected evaluator must not be consulted once the value is there.
    const statuses = collectPolicyStatuses(paths, 'CC-BY-4.0', denylist);
    expect(statuses).toEqual(['warnings']);
    expect(policyStatusWord(worstPolicyStatus(statuses))).toBe('Warning');
  });

  it('reproduces the defect: reading it off licenseStatus.computedStatus yields nothing', () => {
    const wrong = [];
    contextPathsFrom(storedDemoPaths()).forEach(function (item) {
      (item.path.licenses || []).forEach(function (license) {
        const computed = license.licenseStatus && license.licenseStatus.computedStatus;
        if (computed && computed.status) wrong.push(computed.status);
      });
    });
    // Empty for every stored document there has ever been - hence "Pending"
    // forever, under a hint telling the user to run Analyse.
    expect(wrong).toEqual([]);
  });

  it('only answers for the license that was set, never a sibling on the same path', () => {
    const paths = contextPathsFrom(storedDemoPaths());
    paths[0].path.licenses.push({key: 'GPL-3.0-only', status: {status: 'violations'}});
    expect(collectPolicyStatuses(paths, 'CC-BY-4.0', function () {
      return {status: 'ok'};
    })).toEqual(['ok']);
    expect(collectPolicyStatuses(paths, 'MIT', denylist)).toEqual([]);
  });

  it('takes the worst verdict when the component sits on several paths', () => {
    const stored = storedDemoPaths();
    const paths = contextPathsFrom(stored.concat(JSON.parse(JSON.stringify(stored))));
    let call = 0;
    const statuses = collectPolicyStatuses(paths, 'CC-BY-4.0', function () {
      call = call + 1;
      return {status: call === 1 ? 'ok' : 'violations'};
    });
    expect(statuses).toEqual(['ok', 'violations']);
    expect(worstPolicyStatus(statuses)).toBe('violations');
  });

  it('reads the raw path descriptor as well as the context wrapper', () => {
    // licenseResolutionContext parks the descriptor under `path`; the descriptor
    // itself is what the analysis document holds. Both must work, or a shape
    // change goes silently empty again.
    expect(collectPolicyStatuses(storedDemoPaths(), 'CC-BY-4.0', denylist)).toEqual(['violations']);
  });

  it('never guesses: no evaluator and no stored verdict means no status', () => {
    expect(collectPolicyStatuses(null, 'MIT')).toEqual([]);
    expect(collectPolicyStatuses([{path: {licenses: [{key: 'MIT'}]}}], 'MIT', denylist)).toEqual([]);
    expect(collectPolicyStatuses([{path: {licenses: [{key: 'MIT', status: {}}]}}], 'MIT', function () {
      return null;
    })).toEqual([]);
    expect(collectPolicyStatuses([{path: {licenses: [{key: 'MIT', status: {}}]}}], '', denylist)).toEqual([]);
  });

  it('the panel collects through the shared extractor and evaluates policy itself', () => {
    expect(resolveJs).toMatch(/collectPolicyStatuses\(/);
    expect(resolveJs).not.toMatch(/licenseStatus/);
    // Recomputed rather than only read back: `status.computedStatus` is written
    // as a side effect of the per-path sections rendering, and they sit BELOW
    // this one, so on a first render it is not there yet.
    expect(resolveJs).toMatch(/Utils\.computedLicenseStatusDetails\(/);
  });
});

describe('#139 D6 - the saving overlay is removed from the element it was added to', () => {
  it('never clears the overlay by selector across the whole document', () => {
    // $('.aside-section-content').removeClass(...) would also clear it from a
    // sibling section that is still saving under it.
    expect(resolveJs).not.toMatch(/\$\(ASIDE_CLASS\)\.removeClass/);
    expect(resolveJs.match(/overlay\.removeClass\(IN_PROGRESS\)/g) || []).toHaveLength(2);
    expect(resolveJs.match(/const overlay = \$\(trigger\)\.closest\(ASIDE_CLASS\)\.addClass\(IN_PROGRESS\)/g) || [])
      .toHaveLength(2);
  });
});

describe('#139 D7 - only one license section renders at a time', () => {
  it('gates the root-picker section on the same condition that suppresses the new one', () => {
    expect(asideHtml).toContain('{{#unless rootPickerOwnsComponent}}');
    expect(asideHtml).toContain('{{#if rootPickerOwnsComponent}}');
    // The bare root flag left an empty gavel panel beside the new section on a
    // standard-tier account, and a second data-id="aside-legal" with it.
    expect(asideHtml).not.toContain('{{#if isRootComponent}}');
    expect(asideJs).not.toContain('isRootComponent');
  });

  it('requires every gate the picker itself applies before claiming ownership', () => {
    const helper = asideJs.slice(asideJs.indexOf('rootPickerOwnsComponent: function'));
    expect(helper).toContain('this.root');
    expect(helper).not.toContain('accountType');
    expect(helper).toContain('canSetComponentLicense()');
    expect(helper).toMatch(/rootKey/);
  });
});

describe('#139 D3 - a LIC risk is not rendered as a broken SARIF import', () => {
  it('gates the SARIF strip and the Occurrences tab on autoTool, not autoKey', () => {
    expect(riskEditJs).toContain('isSarifManaged: function () {');
    expect(riskEditJs).toMatch(/isSarifManaged: function \(\) \{\s*return !!riskProps\(\)\.autoTool;/);
    expect(riskEditJs).not.toContain('isAutoManaged');
    expect(riskEditHtml).not.toContain('isAutoManaged');
    expect(riskEditHtml.match(/\{\{#if isSarifManaged\}\}/g) || []).toHaveLength(3);
  });

  it('never reaches the SARIF copy from an autoKey another importer wrote', () => {
    expect(riskEditJs).not.toMatch(/riskProps\(\)\.autoKey/);
    expect(riskEditJs).not.toMatch(/props\.autoKey/);
  });

  it('names the license instead, and never calls it resolved', () => {
    expect(riskEditJs).toContain('autoLicense: function () {');
    expect(riskEditHtml).toContain('{{#if autoLicense}}');
    expect(riskEditHtml).toContain('unmatched license set manually to <span class="risk-source-strip-tool">{{autoLicense}}</span>');
    const strip = riskEditHtml.slice(riskEditHtml.indexOf('{{#if autoLicense}}'));
    expect(strip.slice(0, strip.indexOf('{{/if}}'))).not.toMatch(/resolved/i);
  });
});

describe('#139 - the house dash rule holds on every template this change touched', () => {
  const touched = [
    'imports/client/ui/module/common/component-license-resolve.html',
    'imports/client/ui/module/common/component-license-resolve.js',
    'imports/client/ui/module/common/license-catalog-select.html',
    'imports/client/ui/module/common/license-catalog-select.js',
    'imports/client/ui/module/common/licenseResolution.js',
    'imports/client/ui/module/common/root-component-license-picker.html',
    'imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.html',
    'imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.js',
    'imports/client/ui/common/risk-edit/risk-edit.html',
    'imports/client/ui/common/risk-edit/risk-edit.js',
    // Ride-alongs: the same two strings this change converted in the licence
    // picker, and the module header the new copy points the user at twice.
    'imports/client/ui/module/module-details/module-detail.html',
    'imports/client/ui/settings/templates/company-private-licenses.html'
  ];

  touched.forEach(function (file) {
    it('has no em-dash or en-dash in ' + file, () => {
      expect(read(file)).not.toMatch(/[\u2013\u2014]/);
    });
  });

  it('spells the two licence-picker options the same way in both controls', () => {
    const privateLicenses = read('imports/client/ui/settings/templates/company-private-licenses.html');
    expect(privateLicenses).toContain('<option value="">- none -</option>');
    expect(catalogHtml).toContain('<option value="">- none -</option>');
    expect(privateLicenses).toContain('{{#if this.description}} - {{this.description}}{{/if}}');
  });
});

// Reported live: after saving, the licence appeared TWICE - once in an orphaned
// select2 widget, once in the resolved panel. select2 appends its container as a
// sibling of the <select>, and that span is not a Blaze node, so tearing the
// picker down leaves it behind. instance.find() cannot reach the node by then.
describe('#139 - the picker does not survive its own teardown', () => {
  it('destroys select2 from a reference captured while the node still exists', () => {
    expect(catalogJs).toContain('instance._selectNode = node;');
    const destroy = catalogJs.slice(catalogJs.indexOf('onDestroyed'));
    expect(destroy).toContain('this._selectNode');
    expect(destroy).toContain("select2('destroy')");
  });

  it('removes the orphaned container as a backstop', () => {
    const destroy = catalogJs.slice(catalogJs.indexOf('onDestroyed'));
    expect(destroy).toContain('container.parentNode.removeChild(container)');
    expect(catalogJs).toContain("classList.contains('select2-container')");
  });

  it('never renders the picker in the resolved branch', () => {
    const resolved = resolveHtml.slice(
      resolveHtml.indexOf('{{#if isResolved}}', resolveHtml.indexOf('aside-section-content')),
      resolveHtml.indexOf('{{else}}', resolveHtml.indexOf('aside-section-content')));
    expect(resolved).not.toContain('licenseCatalogSelect');
  });
});

describe('#139 - the undo button is actually clickable', () => {
  // Reported live: a real mouse click collapsed the section instead of undoing.
  // `.section-expand` is absolutely positioned at right:0 with 10px padding, so a
  // pull-right button floats underneath its hit area.
  it('clears the absolutely positioned collapse caret', () => {
    const less = read('imports/client/stylesheets/module/module.import.less');
    const block = less.slice(less.indexOf('.component-license-resolve'));
    expect(block).toMatch(/>\s*\.aside-section-title\s*>\s*\.clear-component-license\s*\{[^}]*margin-right:\s*(3[0-9]|[4-9][0-9])px/);
  });
});

describe('#139 - the risk-management link leaves the aside intact', () => {
  it('opens in a new tab, like every other risks link in the module views', () => {
    expect(resolveHtml).toContain(
      'A risk entry was created in <a href="{{pathFor route=\'risks\' query=riskQuery}}" target="_blank">Risk management</a>.'
    );
  });

  // Reported live: a bare pathFor landed on /risks with no ids, where the page
  // renders only "Please select the project to run a report on the upper right".
  // Both ids are required for the link to show the risk it just announced.
  it('carries projectId AND moduleId, or the risks page renders nothing', () => {
    expect(resolveHtml).toContain('query=riskQuery');
    expect(resolveHtml).not.toMatch(/pathFor route='risks'\}\}/);
    const helper = resolveJs.slice(resolveJs.indexOf('riskQuery:'));
    expect(helper).toContain('projectId: module.projectId');
    expect(helper).toContain('moduleId: this.moduleId');
    // An incomplete pair is worse than none: it looks like a filter and is not.
    expect(helper).toContain('if (!module || !module.projectId) return {};');
  });
});

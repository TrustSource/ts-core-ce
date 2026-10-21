/* eslint-disable no-undef */
// What a manual license resolution IS: the validation of the four
// arguments, the entry that gets stored on the module, and the "nothing changed"
// test that makes a resubmit free.
//
// Pure CommonJS so Jest can require it (AC27). Every DECISION lives here; the
// interactor (imports/lib/interactors/modules/resolveComponentLicense.js) only
// does the database work.
const {
  MODULE_ID_MAX,
  COMPONENT_KEY_MAX,
  LICENSE_KEY_MAX,
  JUSTIFICATION_MAX,
  RESOLUTION_COMMENT,
  validateComponentTarget,
  validateResolutionInput,
  buildResolutionEntry,
  isResolutionUnchanged,
  findSelectedEntry,
  findResolution
} = require('../../imports/lib/licenseResolution/resolutionEntry');

const OK = {moduleId: 'mod123', componentKey: 'npm:left-pad', license: 'MIT',
  justification: 'Checked upstream, the package is MIT.'};

function withInput(overrides) {
  return Object.assign({}, OK, overrides);
}

const USER = {_id: 'usr1', profile: {name: 'Ada Lovelace', companyId: 'co1'},
  emails: [{address: 'ada@example.com'}]};

describe('bounds', () => {
  it('mirrors the schema maxima it has to stay inside', () => {
    // COMPONENT_KEY_MAX mirrors CustomComponentSchema.key.max (moduleSchema.js);
    // LICENSE_KEY_MAX mirrors SelectedLicensesEntrySchema.key.max. Both go into
    // a Mongo selector, so they are enforced before any work.
    expect(MODULE_ID_MAX).toBe(64);
    expect(COMPONENT_KEY_MAX).toBe(250);
    expect(LICENSE_KEY_MAX).toBe(100);
    expect(JUSTIFICATION_MAX).toBe(2000);
  });
});

describe('validateResolutionInput', () => {
  it('accepts the happy path', () => {
    expect(validateResolutionInput(OK)).toEqual({ok: true});
  });

  it('refuses a missing, empty or non-string moduleId', () => {
    [undefined, null, '', 0, 1, {}, [], ['m'], true].forEach((moduleId) => {
      expect(validateResolutionInput(withInput({moduleId})))
        .toEqual({ok: false, reason: 'Invalid arguments'});
    });
  });

  it('refuses a moduleId longer than the bound', () => {
    expect(validateResolutionInput(withInput({moduleId: 'a'.repeat(MODULE_ID_MAX + 1)})).ok)
      .toBe(false);
    expect(validateResolutionInput(withInput({moduleId: 'a'.repeat(MODULE_ID_MAX)})).ok).toBe(true);
  });

  it('refuses a missing, empty, non-string or over-long componentKey', () => {
    [undefined, null, '', 7, {}, []].forEach((componentKey) => {
      expect(validateResolutionInput(withInput({componentKey})).reason).toBe('Invalid arguments');
    });
    expect(validateResolutionInput(
      withInput({componentKey: 'a'.repeat(COMPONENT_KEY_MAX + 1)})).ok).toBe(false);
    expect(validateResolutionInput(
      withInput({componentKey: 'a'.repeat(COMPONENT_KEY_MAX)})).ok).toBe(true);
  });

  it('refuses a missing, empty, non-string or over-long license (AC9)', () => {
    [undefined, null, '', 7, {}, [], ['MIT']].forEach((license) => {
      expect(validateResolutionInput(withInput({license})).reason).toBe('Invalid arguments');
    });
    expect(validateResolutionInput(
      withInput({license: 'a'.repeat(LICENSE_KEY_MAX + 1)})).ok).toBe(false);
    expect(validateResolutionInput(
      withInput({license: 'a'.repeat(LICENSE_KEY_MAX)})).ok).toBe(true);
  });

  it('refuses a non-string or over-long justification as an argument error', () => {
    [undefined, null, 7, {}, [], true].forEach((justification) => {
      expect(validateResolutionInput(withInput({justification})).reason)
        .toBe('Invalid arguments');
    });
    // The BOUND is on the raw length, not the trimmed one: what gets stored is
    // the verbatim text.
    expect(validateResolutionInput(
      withInput({justification: 'a'.repeat(JUSTIFICATION_MAX + 1)})).reason)
      .toBe('Invalid arguments');
    expect(validateResolutionInput(
      withInput({justification: 'a'.repeat(JUSTIFICATION_MAX)})).ok).toBe(true);
  });

  it('refuses whitespace-only justification with its own reason (AC9)', () => {
    ['', ' ', '   ', '\t', '\n', ' \t\r\n '].forEach((justification) => {
      expect(validateResolutionInput(withInput({justification})))
        .toEqual({ok: false, reason: 'Justification required'});
    });
  });

  it('accepts a justification that is only meaningful after trimming', () => {
    expect(validateResolutionInput(withInput({justification: '  x  '})).ok).toBe(true);
  });

  it('checks the arguments in the declared order', () => {
    // All four wrong: the caller is told about the FIRST problem, so the reason
    // string stays a fixed literal and never leaks which of their values the
    // server happened to look at last.
    expect(validateResolutionInput({moduleId: '', componentKey: '', license: '',
      justification: '   '}).reason).toBe('Invalid arguments');
    // ...and a whitespace-only justification is only reported once everything
    // else is sound.
    expect(validateResolutionInput(withInput({justification: '  '})).reason)
      .toBe('Justification required');
  });

  it('survives being handed nothing at all', () => {
    expect(validateResolutionInput(undefined).ok).toBe(false);
    expect(validateResolutionInput(null).ok).toBe(false);
    expect(validateResolutionInput({}).ok).toBe(false);
  });
});

describe('validateComponentTarget - the two arguments the undo method takes', () => {
  it('accepts a well-formed pair', () => {
    expect(validateComponentTarget({moduleId: 'mod123', componentKey: 'npm:left-pad'}))
      .toEqual({ok: true});
  });

  it('applies the SAME bounds as the resolve path, not a second copy', () => {
    expect(validateComponentTarget({moduleId: 'a'.repeat(MODULE_ID_MAX + 1),
      componentKey: 'k'}).reason).toBe('Invalid arguments');
    expect(validateComponentTarget({moduleId: 'm',
      componentKey: 'a'.repeat(COMPONENT_KEY_MAX + 1)}).reason).toBe('Invalid arguments');
    [undefined, null, '', 7, {}, []].forEach((bad) => {
      expect(validateComponentTarget({moduleId: bad, componentKey: 'k'}).ok).toBe(false);
      expect(validateComponentTarget({moduleId: 'm', componentKey: bad}).ok).toBe(false);
    });
  });

  it('never asks about a license or a justification', () => {
    expect(validateComponentTarget({moduleId: 'm', componentKey: 'k'}).ok).toBe(true);
  });

  it('survives being handed nothing at all', () => {
    [undefined, null, {}].forEach((v) => expect(validateComponentTarget(v).ok).toBe(false));
  });
});

describe('buildResolutionEntry', () => {
  const now = new Date('2026-09-09T10:11:12.000Z');
  const entry = buildResolutionEntry({componentKey: 'npm:left-pad', license: 'MIT',
    justification: '  Checked upstream.  ', user: USER, now});

  it('stores the text, the author and the timestamp (AC10)', () => {
    expect(entry).toEqual({
      key: 'npm:left-pad',
      license: 'MIT',
      comment: RESOLUTION_COMMENT,
      justification: '  Checked upstream.  ',
      resolvedBy: 'Ada Lovelace',
      resolvedById: 'usr1',
      resolvedAt: now
    });
  });

  it('stores the justification VERBATIM, not a trimmed or escaped copy', () => {
    // It is an audit record. Trimming it would make an identical resubmit read
    // as a change, and escaping it would corrupt what the user wrote.
    expect(entry.justification).toBe('  Checked upstream.  ');
  });

  it('carries no `version`, which is why the schema field had to become optional', () => {
    expect(entry.version).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(entry, 'version')).toBe(false);
  });

  it('falls back to the account name when the profile carries no real name', () => {
    const bare = buildResolutionEntry({componentKey: 'k', license: 'MIT', justification: 'x',
      user: {_id: 'u2', profile: {}, emails: [{address: 'bob@example.com'}]}, now});
    expect(bare.resolvedBy).toBe('bob@example.com');
    expect(bare.resolvedById).toBe('u2');
  });

  it('never leaves resolvedBy undefined, so the panel cannot render a blank author', () => {
    const anon = buildResolutionEntry({componentKey: 'k', license: 'MIT', justification: 'x',
      user: {_id: 'u3'}, now});
    expect(typeof anon.resolvedBy).toBe('string');
    expect(anon.resolvedBy.length).toBeGreaterThan(0);
  });

  it('defaults the timestamp when the caller supplies none', () => {
    const before = Date.now();
    const auto = buildResolutionEntry({componentKey: 'k', license: 'MIT',
      justification: 'x', user: USER});
    expect(auto.resolvedAt instanceof Date).toBe(true);
    expect(auto.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('uses a fixed comment that fits the schema bound', () => {
    // SelectedLicensesEntrySchema.comment is min 1 / max 200 and NOT optional,
    // so an entry without one would 400 a REST module PUT.
    expect(typeof RESOLUTION_COMMENT).toBe('string');
    expect(RESOLUTION_COMMENT.length).toBeGreaterThanOrEqual(1);
    expect(RESOLUTION_COMMENT.length).toBeLessThanOrEqual(200);
  });
});

describe('findSelectedEntry / findResolution', () => {
  const module = {componentConfig: {licensesSelected: [
    {key: 'npm:a', license: 'MIT', comment: 'multi-license modal'},
    {key: 'npm:b', license: 'Apache-2.0', comment: 'x', justification: 'because'},
    null
  ]}};

  it('findSelectedEntry returns any entry for the key, ours or not', () => {
    expect(findSelectedEntry(module, 'npm:a').license).toBe('MIT');
    expect(findSelectedEntry(module, 'npm:b').license).toBe('Apache-2.0');
    expect(findSelectedEntry(module, 'npm:missing')).toBeNull();
  });

  it('findResolution returns ONLY entries carrying a justification (AC18/AC19)', () => {
    // The discriminator. Without it, undo would delete a multi-license-modal pick
    // or a root-picker pick that this feature never wrote.
    expect(findResolution(module, 'npm:a')).toBeNull();
    expect(findResolution(module, 'npm:b').justification).toBe('because');
  });

  it('treats a blank justification as not ours', () => {
    const blank = {componentConfig: {licensesSelected: [
      {key: 'npm:c', license: 'MIT', comment: 'x', justification: ''},
      {key: 'npm:d', license: 'MIT', comment: 'x', justification: '   '}
    ]}};
    expect(findResolution(blank, 'npm:c')).toBeNull();
    expect(findResolution(blank, 'npm:d')).toBeNull();
  });

  it('survives a malformed module document', () => {
    [null, undefined, {}, {componentConfig: null}, {componentConfig: {licensesSelected: 'nope'}}]
      .forEach((m) => {
        expect(findSelectedEntry(m, 'npm:a')).toBeNull();
        expect(findResolution(m, 'npm:a')).toBeNull();
      });
  });

  it('does not answer with an inherited object member for a crafted key', () => {
    expect(findSelectedEntry(module, 'constructor')).toBeNull();
    expect(findResolution(module, '__proto__')).toBeNull();
  });
});

describe('isResolutionUnchanged', () => {
  const stored = {key: 'npm:a', license: 'MIT', comment: RESOLUTION_COMMENT,
    justification: 'because', resolvedBy: 'Ada', resolvedById: 'u1',
    resolvedAt: new Date('2026-01-01T00:00:00.000Z')};

  function next(overrides) {
    return Object.assign({}, stored, {resolvedAt: new Date(), resolvedBy: 'Someone else',
      resolvedById: 'u9'}, overrides);
  }

  it('is true for an identical resubmit, whoever resubmits it and whenever', () => {
    // The DDP-retry case and the "user clicks Save twice" case are
    // the same case. Author and timestamp are DELIBERATELY not compared: a retry
    // of the same intent must not rewrite the audit trail.
    expect(isResolutionUnchanged(stored, next({}))).toBe(true);
  });

  it('is false when the license changed', () => {
    expect(isResolutionUnchanged(stored, next({license: 'Apache-2.0'}))).toBe(false);
  });

  it('is false when the justification changed, even only in whitespace', () => {
    expect(isResolutionUnchanged(stored, next({justification: 'because '}))).toBe(false);
    expect(isResolutionUnchanged(stored, next({justification: 'Because'}))).toBe(false);
  });

  it('is false when the stored entry is not one of ours', () => {
    // A multi-license-modal pick for the same key carries no justification, so
    // resolving that component IS a change - it gains an audit trail.
    expect(isResolutionUnchanged({key: 'npm:a', license: 'MIT', comment: 'modal'},
      next({}))).toBe(false);
  });

  it('is false when there is no stored entry at all', () => {
    expect(isResolutionUnchanged(null, next({}))).toBe(false);
    expect(isResolutionUnchanged(undefined, next({}))).toBe(false);
  });
});

describe('the module stays requirable from both bundles', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = fs.readFileSync(
    path.join(__dirname, '../../imports/lib/licenseResolution/resolutionEntry.js'), 'utf8');

  it('imports nothing from meteor/ and nothing server-only (AC27)', () => {
    expect(raw).not.toMatch(/require\(\s*['"]meteor\//);
    expect(raw).not.toMatch(/from\s+['"]meteor\//);
    expect(raw).not.toMatch(/imports\/server\//);
  });

  it('reuses userDisplayName rather than re-deriving an author label', () => {
    expect(raw).toMatch(/require\(['"]\.\.\/user\/displayName['"]\)/);
    expect(raw).not.toMatch(/function\s+userDisplayName/);
  });
});

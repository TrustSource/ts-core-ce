/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The CWE affordances on the findings page and in the tests tables - the halves
// that live in the Blaze templates.
//
// Blaze cannot be rendered under Jest and `yarn meteor-test` dies at boot on
// this machine, so these are assertions on the template source, the same
// approach (and the same comment-stripping precaution) as
// tests-details-findings-template.unit.spec.js. The defects they pin are all
// wrong-token defects, which is exactly what a text assertion can hold:
//
//   * "Edit CWE" offered on a rule the tool classified, opening an empty modal
//     whose save created a second, double-counting assignment;
//   * a bare "-" in the CWEs column meaning both "no weaknesses" and "never
//     recorded";
//   * {{__ 'Weaknesses'}}, a key present in neither locale file, rendering as
//     the key itself and only looking translated;
//   * "1 finding(s)" beside a working pluraliser.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const DETAILS = 'imports/client/ui/code-tests/tests-details.html';
const TABLES = 'imports/client/ui/module/module-details/module-tests/module-tests.html';

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

// HTML comments only - Blaze has no other comment form in a template body. Both
// files carry explanations quoting the strings under test, so stripping is what
// keeps these assertions about the markup.
function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

const DETAILS_RAW = read(DETAILS);
const DETAILS_SOURCE = stripComments(DETAILS_RAW);
const TABLES_SOURCE = stripComments(read(TABLES));

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`could not find ${startMarker}; re-anchor this spec`);
  }
  const end = source.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error(`could not find ${endMarker} after ${startMarker}; re-anchor this spec`);
  }
  return source.slice(start, end);
}

describe('the comment stripper is doing its job', () => {
  it('removes the explanations that quote the strings under test', () => {
    // Non-vacuity for the assertions below: the raw file DOES describe the
    // assign action in a comment.
    expect(DETAILS_RAW).toMatch(/<!--[\s\S]*Assign[\s\S]*-->/);
    expect(DETAILS_SOURCE).not.toContain('No tabindex="-1"');
  });
});

describe('#112 the assign affordance follows the assignment, not the tool', () => {
  const trigger = () => block(DETAILS_SOURCE, 'class="test-assign-cwe"', '</a>');

  it('labels the action from whether an assignment exists', () => {
    // The bug: the label came off `groupCwes`, which includes what the TOOL
    // published - so a tool-classified rule read "Edit CWE" while the modal
    // opened empty and saving created a brand new assignment.
    expect(trigger()).toContain('hasAssignedGroupCwe');
    expect(DETAILS_SOURCE).not.toMatch(/\{\{#if groupCwes\}\}/);
  });

  it('says what it will edit, in both the label and the tooltip', () => {
    const source = trigger();
    expect(source).toMatch(/Edit[^<]*CWE/);
    expect(source).toMatch(/Assign[^<]*CWE/);
    // The tooltip used to say "Assign a CWE to this rule" in both states.
    expect(source).toMatch(/title="\{\{#if hasAssignedGroupCwe\}\}/);
  });

  it('is gated so the action is offered only where it applies', () => {
    expect(trigger()).toBeTruthy();
    expect(DETAILS_SOURCE).toContain('{{#if canAssignGroupCwe}}');
  });

  it('names the same action the same way throughout the dialog', () => {
    // One action was named four ways in one dialog: weakness / CWE / CWE id /
    // Weaknesses. The ids are CWEs everywhere they are listed - which is what
    // the tests list column header already calls them - and "weakness" is left
    // to the prose that explains what a CWE is.
    const modal = block(DETAILS_SOURCE, 'id="assignCweModal"', '{{> RiskAddModal');
    expect(modal).toMatch(/<label>CWEs<\/label>/);
    expect(modal).not.toMatch(/<label>Weakness/);
    expect(modal).toMatch(/id="assignCweModalTitle"/);
  });
});

describe('#126 an empty CWEs cell says which kind of empty it is', () => {
  it('never renders a bare, unexplained dash', () => {
    const cell = block(TABLES_SOURCE, '<template name="reactiveTableModuleTestsCwes">', '</template>');
    expect(cell).not.toMatch(/<span class="text-muted">-<\/span>/);
    expect(cell).toContain('emptyCwes');
    expect(cell).toContain('title="{{title}}"');
  });
});

describe('#126 the weakness tooltips read as English', () => {
  it('has no "finding(s)" left on either surface', () => {
    [DETAILS_SOURCE, TABLES_SOURCE].forEach((source) => {
      expect(source).not.toContain('finding(s)');
      expect(source).not.toContain('(s)');
    });
    expect(DETAILS_SOURCE).toContain('{{countLabel}}');
    expect(TABLES_SOURCE).toContain('{{countLabel}}');
  });

  it('spells out what "assigned" means on every surface, not just the detail page', () => {
    // The tests list said only ", assigned"; the distinction between a human's
    // claim and the tool's output is the entire point of the badge.
    const phrase = 'assigned here rather than reported by the tool';
    expect(TABLES_SOURCE).toContain(phrase);
    expect(DETAILS_SOURCE).toContain(phrase);
  });

  it('gives the unclassified counter a noun', () => {
    expect(DETAILS_SOURCE).not.toMatch(/\{\{unclassifiedRuleCount\}\}\s*unclassified/);
    expect(DETAILS_SOURCE).toContain('{{unclassifiedRuleLabel}}');
  });

  it('starts the missing-location placeholder with a capital, and gives it a tooltip', () => {
    const row = block(DETAILS_SOURCE, 'test-finding-file', '</div>');
    expect(row).toContain('No file location reported');
    expect(row).not.toContain('no file location reported');
    // The {{#with}} that fills the title needs its own {{else}}, or hovering a
    // location-less finding yields an empty tooltip.
    expect(row).toMatch(/title="\{\{#with physicalLocation\}\}[^"]*\{\{else\}\}[^"]*"/);
  });

  it('explains the status square it draws beside each finding', () => {
    const row = block(DETAILS_SOURCE, 'test-status-icon', '</div>');
    expect(row).toContain('{{getTestStatus ..}}');
    expect(row).toContain('{{getTestStatusTitle ..}}');
  });
});

describe('#126 every translated string on the findings page has a translation', () => {
  const KEY_LINE = /^([A-Za-z0-9_]+):/;

  function localeKeys(file) {
    return new Set(read(file).split('\n')
      .map((line) => (line.match(KEY_LINE) || [])[1])
      .filter(Boolean));
  }

  it('uses no i18n key that locales/en.i18n.yml does not define', () => {
    // `{{__ 'Weaknesses'}}` was in neither locale file. universe:i18n falls back
    // to the key itself, so the string only looked right - and it was the sole
    // i18n call among ~15 new strings whose neighbours are all hardcoded.
    const keys = localeKeys('locales/en.i18n.yml');
    const used = [...DETAILS_SOURCE.matchAll(/\{\{__ '([^']+)'\}\}/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    // Non-vacuity: the reader really does miss a key that is not there.
    expect(keys.has('Weaknesses')).toBe(false);
    expect(keys.has('TestDetails')).toBe(true);
    used.forEach((key) => expect(keys.has(key)).toBe(true));
  });
});

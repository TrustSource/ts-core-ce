/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The two findings-list bugs that live entirely in the Blaze template.
//
// The behaviours they pin:
//   Findings without a file location (project-wide and configuration-level
//   rules) are shown.
//   Grouping test findings By File shows each finding's own severity.
//
// The first has a testable half - `findingLocations()` in findingSummary.js,
// covered by the spec that shipped - but the half that actually made findings
// appear is the template switching `{{#each locations}}` to
// `{{#each findingLocations}}`. The second is nothing BUT a template change:
// `{{getTestStatus ../..}}` (the group) became `{{getTestStatus ..}}` (the
// result). Both are one-token edits in a .html file, both are invisible to every
// existing test, and both would be re-broken by a careless revert with no test
// anywhere going red.
//
// `yarn meteor-test` cannot run on this machine (Meteor 3.5 + Node 24 kill it at
// boot), and Blaze templates cannot be rendered under Jest, so a structural
// assertion on the template source is what is available. It is worth having:
// the failure mode is a wrong argument path, which is exactly what a text
// assertion can pin.
//
// Blaze comments are HTML comments, and the file carries one immediately above
// the line under test that quotes the OLD broken form - so the source is stripped
// of comments first. Without that, this spec would false-pass on the explanation
// instead of the code.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const TEMPLATE = 'imports/client/ui/code-tests/tests-details.html';

const RAW = fs.readFileSync(path.join(__dirname, '../..', TEMPLATE), 'utf8');
// HTML comments only - Blaze has no other comment form in a template body.
const SOURCE = RAW.replace(/<!--[\s\S]*?-->/g, '');

// The finding row: `{{#each list}}` -> `{{#each findingLocations}}` -> the row.
function findingRowBlock() {
  const start = SOURCE.indexOf('{{#each list}}');
  if (start === -1) {
    throw new Error(`${TEMPLATE} no longer contains {{#each list}}; re-anchor this spec`);
  }
  const end = SOURCE.indexOf('</div>', SOURCE.indexOf('test-finding-snippet', start));
  if (end === -1) {
    throw new Error(`${TEMPLATE}: could not find the end of the finding row; re-anchor this spec`);
  }
  return SOURCE.slice(start, end);
}

describe('the comment stripper is doing its job', () => {
  it('removes the explanation that quotes the OLD broken form', () => {
    // Non-vacuity for every assertion below: the raw file DOES contain
    // `getTestStatus ../..` - inside a comment. If the stripping stopped
    // working, the "no group context" assertion would false-pass.
    expect(RAW).toContain('../..');
    expect(RAW).toMatch(/<!--[\s\S]*\.\.\/\.\.[\s\S]*-->/);
    expect(SOURCE).not.toContain('`..` is the result');
  });
});

describe('#127 a finding with no file location still gets a row', () => {
  it('iterates the findingLocations helper, not the raw locations array', () => {
    // `result.locations` is optional in SARIF 2.1.0 (3.27.12). Iterating it
    // directly rendered nothing for a project-wide finding: the group header
    // counted it and the panel body stayed empty.
    const block = findingRowBlock();
    expect(block).toContain('{{#each findingLocations}}');
    expect(block).not.toMatch(/\{\{#each locations\}\}/);
  });

  it('renders a visible placeholder when the location carries no uri', () => {
    // Sentence-initial, so it is capitalised: it stands where a file path would,
    // at the start of the row, not mid-sentence.
    expect(findingRowBlock()).toContain('No file location reported');
    // ...via {{#with}}'s else branch, which is what fires on a missing
    // physicalLocation rather than printing an empty <strong>.
    expect(findingRowBlock()).toMatch(/\{\{#with physicalLocation\}\}[\s\S]*?\{\{else\}\}/);
  });

  it('is backed by a helper that hands back one placeholder', () => {
    // The template half above only works because the helper never returns [].
    const {findingLocations} = require('../../imports/lib/sarif/findingSummary');
    expect(findingLocations({ruleId: 'r'})).toEqual([{}]);
    expect(findingLocations({ruleId: 'r', locations: []})).toEqual([{}]);
  });
});

describe('#126 By File shows each finding at its own severity', () => {
  it('passes the RESULT to getTestStatus, never the group', () => {
    const block = findingRowBlock();
    // `..` inside {{#each findingLocations}} is the result. `../..` is the
    // group, whose `ruleId` is a file path in By File mode - so no rule
    // resolved, and every icon fell through to the red 'FAILED' default.
    expect(block).toMatch(/\{\{getTestStatus \.\.\}\}/);
    expect(block).not.toMatch(/\{\{getTestStatus \.\.\/\.\.\}\}/);
  });

  it('passes the RESULT to getTestMessage too, for the same reason', () => {
    const block = findingRowBlock();
    expect(block).toMatch(/\{\{getTestMessage \.\.\}\}/);
    expect(block).not.toMatch(/\{\{getTestMessage \.\.\/\.\.\}\}/);
  });

  it('resolves each group\'s own severity through the shared reader', () => {
    // The other half of the fix: whatever the template hands over, the level has
    // to come from the result or its rule. Pinned on the shipped reader so a
    // By File group made of two different rules really does get two levels.
    const {resolveResultSeverity} = require('../../imports/lib/sarif/runStatus');
    const rules = [
      {id: 'noisy', defaultConfiguration: {level: 'note'}},
      {id: 'severe', defaultConfiguration: {level: 'error'}}
    ];
    const sameFile = [{ruleId: 'noisy'}, {ruleId: 'severe'}];
    expect(sameFile.map((result) => resolveResultSeverity(result, rules).level))
      .toEqual(['note', 'error']);
  });
});

describe('#126 the weakness badges link out safely', () => {
  it('opens MITRE in a new tab without handing it the opener', () => {
    const badges = SOURCE.match(/<a[^>]*class="test-cwe-badge[^"]*"[^>]*>/g) || [];
    expect(badges.length).toBeGreaterThan(0);
    badges.forEach((badge) => {
      expect(badge).toContain('target="_blank"');
      expect(badge).toContain('rel="noopener noreferrer"');
    });
  });

  it('keeps the Assign CWE modal focusable by select2', () => {
    // Documented project rule: tabindex="-1" on a modal stops the select2 search
    // input taking keyboard focus, and this modal is a tags-mode select2.
    const modal = SOURCE.slice(SOURCE.indexOf('id="assignCweModal"'));
    expect(modal.length).toBeGreaterThan(0);
    expect(SOURCE).not.toMatch(/id="assignCweModal"[^>]*tabindex/);
    expect(modal).toContain('name="assignCwes"');
  });
});

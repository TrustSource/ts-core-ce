/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// `kind` decides whether a SARIF result is a finding at all; `level` only says
// how severe a finding is (regression from the CodeQL catalogue fix).
//
// SARIF 2.1.0 (3.27.10): "If kind has any value other than 'fail', then, if
// level is absent, it SHALL default to 'none'. If level is present, it SHALL
// have the value 'none'." So a `pass`, `informational`, `notApplicable`,
// `review` or `open` result is never a finding, whatever the rule's
// defaultConfiguration says.
//
// `resolveResultSeverity` consulted `rule.defaultConfiguration.level` BEFORE it
// consulted `kind`, so the `kind` guard only ever fired for a rule that declared
// no default level at all. Every CodeQL and semgrep rule declares one - and
// since `collectRules` was taught to reach the extension-hosted CodeQL
// catalogue, results that previously resolved no rule now inherit `error`. A run
// with one genuine failure and three non-failing results reported
// `{violations: 4, total: 4}` where it used to report `{total: 0}`.
//
// The existing coverage in sarif-import-catalog.unit.spec.js only exercises
// `kind` against a rule with NO default level (`B602`), which is exactly the
// case the bug leaves working.
// ---------------------------------------------------------------------------
const runStatus = require('../../imports/lib/sarif/runStatus');
const {collectRunCwes} = require('../../imports/lib/sarif/cweExtract');
const {collectRunRuleCounts} = require('../../imports/lib/sarif/cweMappingOverlay');

// The shape that matters: every rule declares a default level, the way CodeQL
// and semgrep really do.
const RULES = [
  {id: 'js/xss', defaultConfiguration: {level: 'error'}},
  {id: 'js/audit', defaultConfiguration: {level: 'note'}}
];

const NON_FAILING_KINDS = ['pass', 'informational', 'notApplicable', 'review', 'open'];

function codeqlRun(results) {
  return {
    tool: {
      driver: {name: 'CodeQL', rules: []},
      extensions: [{name: 'codeql/javascript-queries', rules: [
        {id: 'js/xss', properties: {tags: ['external/cwe/cwe-079']},
          defaultConfiguration: {level: 'error'}}
      ]}]
    },
    results: results
  };
}

describe('#128 resolveResultSeverity consults kind before the rule default', () => {
  NON_FAILING_KINDS.forEach((kind) => {
    it(`does not count a "${kind}" result of a rule whose default level is error`, () => {
      expect(runStatus.resolveResultSeverity({ruleId: 'js/xss', kind: kind}, RULES)).toBeNull();
    });

    it(`does not count a "${kind}" result even when the result states a level itself`, () => {
      // SARIF says such a result's level SHALL be `none`; a tool that writes
      // something else is still not reporting a failure.
      expect(runStatus.resolveResultSeverity({ruleId: 'js/xss', kind: kind, level: 'error'}, RULES))
        .toBeNull();
    });
  });

  it('counts a result that says kind: fail', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'js/xss', kind: 'fail'}, RULES))
      .toEqual({level: 'error', ruleId: 'js/xss'});
  });

  it('counts a result with no kind at all, which SARIF defines as fail', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'js/xss'}, RULES))
      .toEqual({level: 'error', ruleId: 'js/xss'});
    expect(runStatus.resolveResultSeverity({ruleId: 'js/audit'}, RULES))
      .toEqual({level: 'note', ruleId: 'js/audit'});
  });

  it('keeps the #126 fallback for a failing result nothing states a level for', () => {
    expect(runStatus.resolveResultSeverity({ruleId: 'unstated'}, [{id: 'unstated'}]))
      .toEqual({level: 'warning', ruleId: 'unstated'});
  });

  it('still refuses a result it cannot name a rule for', () => {
    expect(runStatus.resolveResultSeverity({level: 'error'}, RULES)).toBeNull();
    expect(runStatus.resolveResultSeverity(null, RULES)).toBeNull();
  });
});

describe('#128 the measured regression: non-failing results counted as findings', () => {
  const RESULTS = [
    {ruleId: 'js/xss', message: {text: 'real finding'}},
    {ruleId: 'js/xss', kind: 'pass'},
    {ruleId: 'js/xss', kind: 'informational'},
    {ruleId: 'js/xss', kind: 'notApplicable'}
  ];

  it('counts one finding, not four, in the per-rule counts', () => {
    expect(collectRunRuleCounts(codeqlRun(RESULTS)))
      .toEqual({violations: {'js/xss': 1}, warnings: {}, notes: {}});
  });

  it('counts one finding, not four, per weakness', () => {
    expect(collectRunCwes(codeqlRun(RESULTS))['CWE-79'])
      .toMatchObject({violations: 1, warnings: 0, notes: 0});
  });

  it('NON-VACUITY: the same four results all count when they all say fail', () => {
    const allFail = RESULTS.map((result) => Object.assign({}, result, {kind: 'fail'}));
    expect(collectRunRuleCounts(codeqlRun(allFail)).violations['js/xss']).toBe(4);
  });

  it('a run of nothing but non-failing results reports no findings at all', () => {
    const run = codeqlRun(NON_FAILING_KINDS.map((kind) => ({ruleId: 'js/xss', kind: kind})));
    expect(collectRunRuleCounts(run)).toEqual({violations: {}, warnings: {}, notes: {}});
    expect(collectRunCwes(run)).toEqual({});
  });
});

describe('#128 the comment above resolveResultSeverity describes what it does', () => {
  const fs = require('fs');
  const path = require('path');
  const SOURCE = fs.readFileSync(
    path.join(__dirname, '../../imports/lib/sarif/runStatus.js'), 'utf8');

  it('no longer claims a non-fail result merely "gets no level here"', () => {
    // The shipped comment said the kind guard was what kept passes uncounted,
    // which was only true for rules with no default level.
    expect(SOURCE).not.toContain('a `pass` or `informational` result gets no\n// level here');
  });

  it('states that kind is consulted first', () => {
    expect(SOURCE).toMatch(/kind[\s\S]{0,400}before[\s\S]{0,200}level|consulted first|asked first/i);
  });
});

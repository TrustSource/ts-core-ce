/* eslint-disable no-undef*/
// A tool that publishes no CWE for a rule leaves that finding
// unreachable by the threat model. The import deliberately refuses to guess one, so
// the gap is closed by a human instead: a Security Manager assigns the weakness,
// and the assignment is overlaid wherever CWEs are read.
//
// The overlay works off `rules.byRule`, the per-rule finding counts every stored
// document already carries - including documents imported before rules.byCwe
// existed. That is what lets an assignment light up historical documents with no
// migration and no re-parse of the stored run.
//
// Meteor-free CommonJS so Jest can require it directly, the same dual-consumption
// pattern as cweExtract.js / runStatus.js / findingSummary.js.
const {indexMappings, mappedCwesForRule, applyMappings, collectRunRuleCounts} =
  require('../../imports/lib/sarif/cweMappingOverlay');
const {formatCweFindings} = require('../../imports/lib/sarif/cweExtract');

// Shaped like the stored document: byRule maps escaped rule id -> finding count,
// one map per level. Rule ids are dotted in the real world (semgrep) and the
// import escapes '.' to '___' before using them as Mongo keys.
const BY_RULE = {
  violations: {'python___lang___security___audit___eval-detected': 4},
  warnings: {'python___lang___security___audit___subprocess-shell-true': 2},
  notes: {}
};

const EVAL_RULE = 'python.lang.security.audit.eval-detected';
const SHELL_RULE = 'python.lang.security.audit.subprocess-shell-true';

function mapping(overrides) {
  return Object.assign({
    companyId: 'acme',
    tool: 'semgrep',
    ruleId: EVAL_RULE,
    cwes: ['CWE-95'],
    status: 'candidate',
    userName: 'Sec Manager'
  }, overrides);
}

describe('#112 indexMappings - whose mapping wins', () => {
  it('resolves a company candidate for the calling company', () => {
    const index = indexMappings([mapping()], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual(['CWE-95']);
  });

  it('falls back to a global default where the company has none', () => {
    const index = indexMappings([mapping({companyId: null, status: 'global'})], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual(['CWE-95']);
  });

  it('lets a company entry replace the global one for the same rule', () => {
    // Replace, not union: a company that disagrees with the global default has
    // to be able to say so without the default still applying underneath.
    const index = indexMappings([
      mapping({companyId: null, status: 'global', cwes: ['CWE-94']}),
      mapping({cwes: ['CWE-95']})
    ], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual(['CWE-95']);
  });

  it('ignores another company\'s candidate entirely', () => {
    // Defence in depth. The publication already scopes by company; if a query
    // anywhere ever forgets to, one customer's classification must still not
    // leak into another's findings.
    const index = indexMappings([mapping({companyId: 'other-corp'})], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual([]);
  });

  it('applies only global entries when there is no company context', () => {
    const index = indexMappings([
      mapping({companyId: null, status: 'global', cwes: ['CWE-94']}),
      mapping({cwes: ['CWE-95']})
    ]);
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual(['CWE-94']);
  });

  it('normalises and drops unusable ids rather than storing them as written', () => {
    const index = indexMappings([mapping({cwes: ['cwe-079', 'nonsense', '', null, 'CWE-95']})], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual(['CWE-79', 'CWE-95']);
  });

  it('drops an entry left with no usable id at all', () => {
    const index = indexMappings([mapping({cwes: ['nonsense']})], 'acme');
    expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual([]);
  });

  it('survives an empty, missing or malformed mapping list', () => {
    [[], null, undefined, [null, {}, {tool: 'semgrep'}]].forEach((input) => {
      const index = indexMappings(input, 'acme');
      expect(mappedCwesForRule(index, 'semgrep', EVAL_RULE)).toEqual([]);
    });
  });
});

describe('#112 mappedCwesForRule - finding the rule again', () => {
  const index = indexMappings([mapping()], 'acme');

  it('matches the tool name whatever case the driver reported it in', () => {
    // The stored `tool` field is the driver name verbatim: "semgrep", "CodeQL",
    // "Bandit". A mapping entered against one spelling has to match the others.
    expect(mappedCwesForRule(index, 'SemGrep', EVAL_RULE)).toEqual(['CWE-95']);
    expect(mappedCwesForRule(index, '  semgrep  ', EVAL_RULE)).toEqual(['CWE-95']);
  });

  it('does not match the same rule id reported by a different tool', () => {
    expect(mappedCwesForRule(index, 'codeql', EVAL_RULE)).toEqual([]);
  });

  it('resolves a rule id given in its stored escaped form', () => {
    // The overlay reads byRule, whose keys are escaped; the findings page reads
    // the parsed run, whose ids are raw. Both have to reach the same entry.
    expect(mappedCwesForRule(index, 'semgrep',
      'python___lang___security___audit___eval-detected')).toEqual(['CWE-95']);
  });

  it('resolves a rule id whose leading $ the import rewrote', () => {
    const dollarIndex = indexMappings([mapping({ruleId: '$special.rule'})], 'acme');
    expect(mappedCwesForRule(dollarIndex, 'semgrep', '$special.rule')).toEqual(['CWE-95']);
    expect(mappedCwesForRule(dollarIndex, 'semgrep', '_dollar_special___rule')).toEqual(['CWE-95']);
  });

  it('returns an empty list for anything it has no entry for', () => {
    [null, undefined, '', 'unknown.rule'].forEach((ruleId) => {
      expect(mappedCwesForRule(index, 'semgrep', ruleId)).toEqual([]);
    });
    expect(mappedCwesForRule(null, 'semgrep', EVAL_RULE)).toEqual([]);
  });
});

describe('#112 applyMappings - an assignment counted like a published CWE', () => {
  it('contributes the rule\'s stored counts under the assigned weakness', () => {
    const index = indexMappings([mapping()], 'acme');
    const byCwe = applyMappings({}, BY_RULE, index, 'semgrep');
    expect(byCwe['CWE-95']).toEqual({
      violations: 4, warnings: 0, notes: 0,
      assigned: {violations: 4, warnings: 0, notes: 0}
    });
  });

  it('counts a rule at whichever level it actually fired', () => {
    const index = indexMappings([mapping({ruleId: SHELL_RULE, cwes: ['CWE-78']})], 'acme');
    const byCwe = applyMappings({}, BY_RULE, index, 'semgrep');
    expect(byCwe['CWE-78'].warnings).toEqual(2);
    expect(byCwe['CWE-78'].violations).toEqual(0);
  });

  it('adds to a weakness the tool already published rather than replacing it', () => {
    // A rule the tool classified and a rule it did not can land on the same
    // weakness. The published count must survive the overlay.
    //
    // This stored map carries no `ruleIds`, so it is a document imported before
    // the per-rule attribution was added: the overlay cannot tell whether the
    // published CWE-79 came from THIS rule, and adds. When the attribution is
    // present, a (rule, cwe) pair the tool published contributes nothing extra -
    // see sarif-cwe-overlay-attribution.unit.spec.js.
    const index = indexMappings([mapping({cwes: ['CWE-79']})], 'acme');
    const byCwe = applyMappings({'CWE-79': {violations: 1, warnings: 0, notes: 0}},
      BY_RULE, index, 'semgrep');
    expect(byCwe['CWE-79'].violations).toEqual(5);
    expect(byCwe['CWE-79'].assigned.violations).toEqual(4);
  });

  it('counts one rule under each weakness a human assigned it', () => {
    const index = indexMappings([mapping({cwes: ['CWE-95', 'CWE-94']})], 'acme');
    const byCwe = applyMappings({}, BY_RULE, index, 'semgrep');
    expect(byCwe['CWE-95'].violations).toEqual(4);
    expect(byCwe['CWE-94'].violations).toEqual(4);
  });

  it('contributes nothing for a rule that produced no finding on this document', () => {
    // The mapping is company-wide; this document simply never ran that rule.
    const index = indexMappings([mapping({ruleId: 'some.rule.that.never.fired'})], 'acme');
    expect(applyMappings({}, BY_RULE, index, 'semgrep')).toEqual({});
  });

  it('leaves the stored map untouched when nothing is mapped', () => {
    const stored = {'CWE-79': {violations: 1, warnings: 0, notes: 0}};
    const byCwe = applyMappings(stored, BY_RULE, indexMappings([], 'acme'), 'semgrep');
    expect(byCwe).toEqual(stored);
  });

  it('does not mutate the caller\'s stored map', () => {
    const stored = {'CWE-79': {violations: 1, warnings: 0, notes: 0}};
    const index = indexMappings([mapping({cwes: ['CWE-79']})], 'acme');
    applyMappings(stored, BY_RULE, index, 'semgrep');
    expect(stored['CWE-79'].violations).toEqual(1);
  });

  it('survives a document with no rules, no byRule or no counts', () => {
    const index = indexMappings([mapping()], 'acme');
    expect(applyMappings(null, null, index, 'semgrep')).toEqual({});
    expect(applyMappings(undefined, {}, index, 'semgrep')).toEqual({});
    expect(applyMappings({}, {violations: null}, index, 'semgrep')).toEqual({});
  });
});

describe('#112 collectRunRuleCounts - the same counts, from a parsed run', () => {
  // The findings page holds the run and not the stored counts, and a document
  // imported before rules.byCwe existed has no stored weakness map at all. Both
  // paths have to reach the same overlay, so the keys have to match byRule's.
  const RUN = {
    tool: {driver: {name: 'semgrep', rules: [
      {id: EVAL_RULE, defaultConfiguration: {level: 'error'}},
      {id: SHELL_RULE, defaultConfiguration: {level: 'warning'}}
    ]}},
    results: [
      {ruleId: EVAL_RULE}, {ruleId: EVAL_RULE},
      {ruleId: SHELL_RULE, level: 'warning'}
    ]
  };

  it('counts each rule at the level it fired, under its escaped id', () => {
    expect(collectRunRuleCounts(RUN)).toEqual({
      violations: {'python___lang___security___audit___eval-detected': 2},
      warnings: {'python___lang___security___audit___subprocess-shell-true': 1},
      notes: {}
    });
  });

  it('feeds the overlay the same way the stored counts do', () => {
    const index = indexMappings([mapping()], 'acme');
    const byCwe = applyMappings({}, collectRunRuleCounts(RUN), index, 'semgrep');
    expect(byCwe['CWE-95'].violations).toEqual(2);
  });

  it('returns empty buckets for a run with no results', () => {
    [null, undefined, {}, {results: []}].forEach((run) => {
      expect(collectRunRuleCounts(run)).toEqual({violations: {}, warnings: {}, notes: {}});
    });
  });
});

describe('#112 documents that predate all of this', () => {
  // Most stored documents were imported before rules.byCwe existed, and some
  // before rules.byRule did. They carry no weakness information at all and must
  // keep reporting exactly what they reported before - an empty list - rather
  // than failing or being treated as a document with something missing.
  const index = indexMappings([mapping()], 'acme');

  it('reports no weaknesses, and does not fail, for a document with no rules', () => {
    expect(formatCweFindings(applyMappings(undefined, undefined, index, undefined))).toEqual([]);
    expect(formatCweFindings(applyMappings(null, null, index, 'semgrep'))).toEqual([]);
  });

  it('reports the tool\'s weaknesses unchanged when nothing is assigned', () => {
    const stored = {'CWE-79': {violations: 2, warnings: 0, notes: 0}};
    expect(formatCweFindings(applyMappings(stored, {}, indexMappings([], 'acme'), 'semgrep')))
      .toEqual([{cwe: 'CWE-79', count: 2, level: 'violation'}]);
  });

  it('still carries an assignment to a document that has only per-rule counts', () => {
    // The whole reason the overlay reads byRule: a document imported before
    // rules.byCwe existed has no weakness map to add to, and still has to pick
    // the assignment up.
    const rows = formatCweFindings(applyMappings(undefined, BY_RULE, index, 'semgrep'));
    expect(rows).toEqual([{cwe: 'CWE-95', count: 4, level: 'violation'}]);
  });
});

describe('#112 formatCweFindings - the row shape #126 published, unchanged', () => {
  // An assignment is counted like any other weakness and the response says
  // nothing about where it came from. The `assigned` sub-count applyMappings
  // leaves behind drives the badge in the UI; it is not part of the API.
  it('emits cwe, count and level, and nothing else', () => {
    const rows = formatCweFindings({'CWE-95': {
      violations: 4, warnings: 0, notes: 0,
      assigned: {violations: 4, warnings: 0, notes: 0}
    }});
    expect(rows).toEqual([{cwe: 'CWE-95', count: 4, level: 'violation'}]);
  });

  it('counts assigned and published findings of one weakness together', () => {
    const rows = formatCweFindings({'CWE-79': {
      violations: 5, warnings: 0, notes: 0,
      assigned: {violations: 4, warnings: 0, notes: 0}
    }});
    expect(rows).toEqual([{cwe: 'CWE-79', count: 5, level: 'violation'}]);
  });

  it('reports a weakness seen at two levels once per level', () => {
    const rows = formatCweFindings({'CWE-79': {
      violations: 3, warnings: 2, notes: 0,
      assigned: {violations: 0, warnings: 2, notes: 0}
    }});
    expect(rows).toEqual([
      {cwe: 'CWE-79', count: 3, level: 'violation'},
      {cwe: 'CWE-79', count: 2, level: 'warning'}
    ]);
  });
});

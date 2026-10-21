/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// A finding is counted once per weakness, whoever named the weakness.
//
// The reported defect. `applyMappings` added a mapped rule's per-rule finding
// count to `out[cwe]` unconditionally. So once a tool started publishing a CWE
// for a rule someone had already assigned that same CWE to - a tool upgrade,
// then a re-import - the same findings were counted twice: REST answered
// `count: 4` for a rule that fired twice.
//
// The fix needs to know WHICH rules the tool published a weakness for, which the
// aggregate `rules.byCwe` map never carried. `collectRunCwes` now records that
// attribution beside the counts (`ruleIds`), the import stores it, and
// `applyMappings` skips a (rule, cwe) pair the tool already published.
//
// The four properties below are the interface contract the findings UI is built
// against; each has its own block.
//
//   1. no double counting for a (rule, cwe) pair
//   2. `assigned` sub-counts are human-sourced only
//   3. assigned[bucket] <= [bucket], always
//   4. the output shape is otherwise unchanged - no `source` field, no
//      attribution leaking into the response
// ---------------------------------------------------------------------------
const {indexMappings, applyMappings, escapeRuleId, collectRunRuleCounts} =
  require('../../imports/lib/sarif/cweMappingOverlay');
const {collectRunCwes, formatCweFindings} = require('../../imports/lib/sarif/cweExtract');

const EVAL_RULE = 'python.lang.security.audit.eval-detected';
const SHELL_RULE = 'python.lang.security.audit.subprocess-shell-true';
const CO = 'acme';

function mapping(overrides) {
  return Object.assign({
    companyId: CO, tool: 'semgrep', ruleId: EVAL_RULE, cwes: ['CWE-95'], status: 'candidate'
  }, overrides);
}

// The stored per-rule finding counts: eval-detected fired 4 times as an error,
// subprocess-shell-true twice as a warning.
const BY_RULE = {
  violations: {[escapeRuleId(EVAL_RULE)]: 4},
  warnings: {[escapeRuleId(SHELL_RULE)]: 2},
  notes: {}
};

// A stored weakness map WITH the attribution the import now writes.
function published(entries) {
  const out = {};
  Object.keys(entries).forEach((cwe) => {
    out[cwe] = Object.assign({violations: 0, warnings: 0, notes: 0}, entries[cwe]);
  });
  return out;
}

// --- the attribution the fix rests on ---------------------------------------

describe('#128 collectRunCwes records which rules published each weakness', () => {
  const RUN = {
    tool: {driver: {name: 'semgrep', rules: [
      {id: EVAL_RULE, properties: {tags: ['CWE-95: Eval Injection']},
        defaultConfiguration: {level: 'error'}},
      {id: 'py/xss', properties: {tags: ['CWE-79', 'CWE-95']},
        defaultConfiguration: {level: 'warning'}}
    ]}},
    results: [{ruleId: EVAL_RULE}, {ruleId: EVAL_RULE}, {ruleId: 'py/xss'}]
  };

  it('names every rule that contributed to a weakness, in first-seen order', () => {
    const byCwe = collectRunCwes(RUN);
    expect(byCwe['CWE-95'].ruleIds).toEqual([EVAL_RULE, 'py/xss']);
    expect(byCwe['CWE-79'].ruleIds).toEqual(['py/xss']);
  });

  it('lists a rule once however often it fired', () => {
    expect(collectRunCwes(RUN)['CWE-95'].ruleIds.filter((id) => id === EVAL_RULE))
      .toHaveLength(1);
  });

  it('keeps the counts it always reported beside the attribution', () => {
    const byCwe = collectRunCwes(RUN);
    expect(byCwe['CWE-95']).toMatchObject({violations: 2, warnings: 1, notes: 0});
    expect(byCwe['CWE-79']).toMatchObject({violations: 0, warnings: 1, notes: 0});
  });

  it('stores the id unescaped, the way the rule really is named', () => {
    // byRule has to escape its keys to be a Mongo field name; an array VALUE has
    // no such restriction, so the readable id is what is kept and the overlay
    // escapes it at lookup time.
    expect(collectRunCwes(RUN)['CWE-95'].ruleIds[0]).toBe(EVAL_RULE);
    expect(collectRunCwes(RUN)['CWE-95'].ruleIds[0]).toContain('.');
  });
});

// --- property 1: no double counting -----------------------------------------

describe('#128 CONTRACT 1 - a (rule, cwe) pair is counted once', () => {
  it('adds nothing when the tool already published the assigned weakness for that rule', () => {
    // The reported reproduction: assign CWE-95, the tool later publishes CWE-95
    // for the same rule, re-import.
    const index = indexMappings([mapping()], CO);
    const byCwe = published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}});
    const out = applyMappings(byCwe, BY_RULE, index, 'semgrep');

    expect(out['CWE-95'].violations).toBe(4);
    expect(formatCweFindings(out)).toEqual([{cwe: 'CWE-95', count: 4, level: 'violation'}]);
  });

  it('BEFORE/AFTER: the same document without attribution is what used to double', () => {
    const index = indexMappings([mapping()], CO);
    const legacy = applyMappings(published({'CWE-95': {violations: 4}}),
      BY_RULE, index, 'semgrep');
    const current = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(legacy['CWE-95'].violations).toBe(8);
    expect(current['CWE-95'].violations).toBe(4);
  });

  it('still adds a rule the tool published a DIFFERENT weakness for', () => {
    // The tool classified this rule as CWE-94; a human also called it CWE-95.
    // The second claim is new information and must still be counted.
    const index = indexMappings([mapping()], CO);
    const out = applyMappings(published({'CWE-94': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(out['CWE-94'].violations).toBe(4);
    expect(out['CWE-95'].violations).toBe(4);
  });

  it('still adds a mapped rule when the weakness came from some OTHER rule', () => {
    // CWE-95 was published for py/xss only; eval-detected is mapped to it and the
    // tool said nothing about eval-detected, so its 4 findings are genuinely new.
    const index = indexMappings([mapping()], CO);
    const out = applyMappings(published({'CWE-95': {violations: 1, ruleIds: ['py/xss']}}),
      BY_RULE, index, 'semgrep');
    expect(out['CWE-95'].violations).toBe(5);
  });

  it('matches the attribution through the rule-id escaping', () => {
    // ruleIds are raw and byRule keys are escaped. A dotted semgrep id has to
    // reach the same rule through both.
    const index = indexMappings([mapping()], CO);
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(EVAL_RULE).not.toBe(escapeRuleId(EVAL_RULE));
    expect(out['CWE-95'].violations).toBe(4);
  });

  it('skips per level, not per weakness', () => {
    // One rule that fires at two levels: the tool published the weakness for it,
    // so neither level may be added a second time.
    const index = indexMappings([mapping({cwes: ['CWE-95']})], CO);
    const byRule = {
      violations: {[escapeRuleId(EVAL_RULE)]: 4},
      warnings: {[escapeRuleId(EVAL_RULE)]: 3},
      notes: {}
    };
    const out = applyMappings(
      published({'CWE-95': {violations: 4, warnings: 3, ruleIds: [EVAL_RULE]}}),
      byRule, index, 'semgrep');
    expect(out['CWE-95']).toMatchObject({violations: 4, warnings: 3, notes: 0});
  });

  it('counts a multi-weakness assignment once per weakness the tool did not publish', () => {
    const index = indexMappings([mapping({cwes: ['CWE-95', 'CWE-94']})], CO);
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(out['CWE-95'].violations).toBe(4);
    expect(out['CWE-94'].violations).toBe(4);
  });
});

// --- property 2: `assigned` is human-sourced only ---------------------------

describe('#128 CONTRACT 2 - assigned counts only what a human alone attributed', () => {
  it('leaves assigned at zero for a pair the tool published', () => {
    const index = indexMappings([mapping()], CO);
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(out['CWE-95'].assigned).toBeUndefined();
  });

  it('counts only the rules the tool stayed silent about', () => {
    const index = indexMappings([
      mapping(),
      mapping({ruleId: SHELL_RULE, cwes: ['CWE-95']})
    ], CO);
    // The tool published CWE-95 for eval-detected (4 findings) but not for
    // subprocess-shell-true (2 findings), and both are assigned CWE-95.
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');

    expect(out['CWE-95']).toMatchObject({violations: 4, warnings: 2, notes: 0});
    expect(out['CWE-95'].assigned).toEqual({violations: 0, warnings: 2, notes: 0});
  });

  it('reports a wholly human-sourced weakness as entirely assigned', () => {
    const index = indexMappings([mapping()], CO);
    const out = applyMappings({}, BY_RULE, index, 'semgrep');
    expect(out['CWE-95']).toEqual({
      violations: 4, warnings: 0, notes: 0,
      assigned: {violations: 4, warnings: 0, notes: 0}
    });
  });

  it('lets the UI tell the two apart: assigned equals the total only when human-sourced', () => {
    // This is the derivation the findings UI makes - pin the seam it reads.
    const index = indexMappings([mapping(), mapping({ruleId: SHELL_RULE, cwes: ['CWE-78']})], CO);
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');

    const whollyAssigned = (cwe) => ['violations', 'warnings', 'notes'].every((bucket) =>
      ((out[cwe].assigned && out[cwe].assigned[bucket]) || 0) === out[cwe][bucket]);
    expect(whollyAssigned('CWE-95')).toBe(false);
    expect(whollyAssigned('CWE-78')).toBe(true);
  });
});

// --- property 3: the sub-counts reconcile -----------------------------------

describe('#128 CONTRACT 3 - assigned never exceeds the total it sits under', () => {
  const CASES = [
    ['nothing published', {}],
    ['published for the mapped rule', {'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}],
    ['published for another rule', {'CWE-95': {violations: 1, ruleIds: ['py/xss']}}],
    ['published without attribution', {'CWE-95': {violations: 1}}],
    ['published at another level', {'CWE-95': {notes: 7, ruleIds: [EVAL_RULE]}}],
    ['attribution present but empty', {'CWE-95': {violations: 2, ruleIds: []}}],
    ['attribution malformed', {'CWE-95': {violations: 2, ruleIds: 'eval'}}]
  ];

  const index = indexMappings([
    mapping(), mapping({ruleId: SHELL_RULE, cwes: ['CWE-95', 'CWE-78']})
  ], CO);

  CASES.forEach(([label, byCwe]) => {
    it(`holds when ${label}`, () => {
      const out = applyMappings(published(byCwe), BY_RULE, index, 'semgrep');
      Object.keys(out).forEach((cwe) => {
        ['violations', 'warnings', 'notes'].forEach((bucket) => {
          const assigned = (out[cwe].assigned && out[cwe].assigned[bucket]) || 0;
          expect(assigned).toBeLessThanOrEqual(out[cwe][bucket]);
          expect(out[cwe][bucket]).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });

  it('holds on the parsed-run path the findings page uses', () => {
    const run = {
      tool: {driver: {name: 'semgrep', rules: [
        {id: EVAL_RULE, properties: {tags: ['CWE-95']}, defaultConfiguration: {level: 'error'}},
        {id: SHELL_RULE, defaultConfiguration: {level: 'warning'}}
      ]}},
      results: [{ruleId: EVAL_RULE}, {ruleId: EVAL_RULE}, {ruleId: SHELL_RULE}]
    };
    const out = applyMappings(collectRunCwes(run), collectRunRuleCounts(run), index, 'semgrep');
    expect(out['CWE-95']).toMatchObject({violations: 2, warnings: 1});
    expect(out['CWE-95'].assigned).toEqual({violations: 0, warnings: 1, notes: 0});
    expect(out['CWE-78']).toMatchObject({warnings: 1});
  });
});

// --- property 4: the shape is otherwise unchanged ---------------------------

describe('#128 CONTRACT 4 - the output shape is the one #126 published', () => {
  const index = indexMappings([mapping(), mapping({ruleId: SHELL_RULE, cwes: ['CWE-78']})], CO);

  it('emits only the three buckets, plus assigned where there is one', () => {
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(Object.keys(out['CWE-95']).sort()).toEqual(['notes', 'violations', 'warnings']);
    expect(Object.keys(out['CWE-78']).sort())
      .toEqual(['assigned', 'notes', 'violations', 'warnings']);
  });

  it('never leaks the stored attribution into the overlay result', () => {
    // `ruleIds` is stored detail. It must not reach a consumer, and above all
    // not the REST response, which is a published contract.
    const out = applyMappings(published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}),
      BY_RULE, index, 'semgrep');
    expect(JSON.stringify(out)).not.toContain('ruleIds');
    expect(JSON.stringify(out)).not.toContain(EVAL_RULE);
  });

  it('emits no source field, on any row', () => {
    const rows = formatCweFindings(applyMappings(
      published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}}), BY_RULE, index, 'semgrep'));
    rows.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(['count', 'cwe', 'level']);
    });
  });

  it('does not mutate the stored map it was handed', () => {
    const stored = published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}});
    const before = JSON.stringify(stored);
    applyMappings(stored, BY_RULE, index, 'semgrep');
    expect(JSON.stringify(stored)).toBe(before);
  });

  it('keeps reporting a document that carries no mappings unchanged', () => {
    const stored = published({'CWE-95': {violations: 4, ruleIds: [EVAL_RULE]}});
    expect(applyMappings(stored, BY_RULE, indexMappings([], CO), 'semgrep'))
      .toEqual({'CWE-95': {violations: 4, warnings: 0, notes: 0}});
  });

  it('survives a document with no rules, no byRule or no counts', () => {
    expect(applyMappings(null, null, index, 'semgrep')).toEqual({});
    expect(applyMappings(undefined, {}, index, 'semgrep')).toEqual({});
    expect(applyMappings({}, {violations: null}, index, 'semgrep')).toEqual({});
  });
});

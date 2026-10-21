/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The display derivations behind the SARIF findings page and the tests tables.
//
// Every one of these used to live inline in a Blaze helper, which is why the
// same question got two different answers on two surfaces:
//
//   * the severity icon fell back to red 'FAILED' while the counting layer
//     counted the same finding as a warning, so a header reading
//     "5 violations, 2 warnings" sat above 7 red rows;
//   * `assigned: !!counts.assigned` marked a badge as a human's claim when only
//     half of its findings came from one, while `groupCwes` in the same file
//     already implemented the opposite (and correct) rule.
//
// They are pure functions now, in one module both surfaces import, so the rules
// are stated once and pinned here. Blaze cannot be rendered under Jest and
// `yarn meteor-test` does not run on this machine, so the template halves are
// covered by source assertions in tests-details-cwe-actions-template.unit.spec.js.
// ---------------------------------------------------------------------------
const {
  NOT_COUNTED_CLASS,
  findingStatusClass,
  findingStatusTitle,
  cweBadgeRows,
  mergeGroupCwes,
  countLabel,
  emptyCweCellState,
  unclassifiedRuleIds,
  groupResultsByRule,
  groupResultsByFile
} = require('../../imports/client/ui/helpers/test-findings');

// The real counting layer, so these are assertions about agreement between two
// shipped modules rather than about a re-typed copy of one of them.
const {resolveResultSeverity} = require('../../imports/lib/sarif/runStatus');
const {BUCKET_BY_LEVEL} = require('../../imports/lib/sarif/cweExtract');

function statusOf(result, rules) {
  return findingStatusClass(result, resolveResultSeverity(result, rules));
}

function countsAsFinding(result, rules) {
  const severity = resolveResultSeverity(result, rules);
  return !!(severity && BUCKET_BY_LEVEL[severity.level]);
}

describe('#123/#126 the severity icon agrees with the severity counters', () => {
  it('paints an unstated severity as a warning, which is what SARIF says it is', () => {
    // The bug: this fell through to 'FAILED', styled the same red as `error`,
    // so two findings the header counted as warnings rendered as violations.
    const result = {ruleId: 'unstated'};
    const rules = [{id: 'unstated'}];
    expect(statusOf(result, rules)).toBe('warning');
    // ...and the counting layer really does put it in the warnings bucket.
    expect(resolveResultSeverity(result, rules).level).toBe('warning');
    expect(countsAsFinding(result, rules)).toBe(true);
  });

  it('never emits FAILED for a finding row', () => {
    // `.test-status-icon.FAILED` is the red used for `error`. Reaching it from a
    // finding row is what made the icons lie; the document-level status cell,
    // where FAILED means "the run failed", is a different template.
    const rules = [{id: 'r', defaultConfiguration: {level: 'note'}}];
    [{ruleId: 'r'}, {ruleId: 'r', level: 'error'}, {ruleId: 'nope'}, {}, null]
      .forEach((result) => expect(statusOf(result, rules)).not.toBe('FAILED'));
  });

  it('mirrors each of the three counted levels', () => {
    const rules = [
      {id: 'e', defaultConfiguration: {level: 'error'}},
      {id: 'w', defaultConfiguration: {level: 'warning'}},
      {id: 'n', defaultConfiguration: {level: 'note'}}
    ];
    expect(['e', 'w', 'n'].map((id) => statusOf({ruleId: id}, rules)))
      .toEqual(['error', 'warning', 'note']);
    // The result's own level outranks the rule default, on both layers.
    expect(statusOf({ruleId: 'n', level: 'error'}, rules)).toBe('error');
  });

  it('paints nothing as a finding that the counters do not count', () => {
    const rules = [{id: 'r'}];
    // `level: "none"` has no bucket in BUCKET_BY_LEVEL, so it contributes to no
    // counter; it must not contribute a coloured square either.
    const none = {ruleId: 'r', level: 'none'};
    expect(countsAsFinding(none, rules)).toBe(false);
    expect(statusOf(none, rules)).toBe(NOT_COUNTED_CLASS);
    // No rule and no level: the counter cannot place it, so neither do we.
    const unresolvable = {level: 'error'};
    expect(countsAsFinding(unresolvable, rules)).toBe(false);
    expect(statusOf(unresolvable, rules)).toBe(NOT_COUNTED_CLASS);
  });

  it('leaves a non-failure result uncoloured whatever its rule declares', () => {
    // SARIF `kind` says whether a result is a failure at all. A `pass` or
    // `informational` result contributes 0 to every counter, so rendering it as
    // a red finding was the loudest form of the same contradiction.
    //
    // Gated here on `kind` directly rather than only on what the severity
    // resolver returns: the display must not paint a violation the counters do
    // not count, even where a rule's defaultConfiguration states a level.
    const rules = [{id: 'r', defaultConfiguration: {level: 'error'}}];
    ['pass', 'informational', 'notApplicable', 'review', 'open'].forEach((kind) => {
      expect(statusOf({ruleId: 'r', kind: kind}, rules)).toBe(NOT_COUNTED_CLASS);
      expect(statusOf({ruleId: 'r', kind: kind, level: 'error'}, rules)).toBe(NOT_COUNTED_CLASS);
    });
    // `fail` is the SARIF default and stays a finding.
    expect(statusOf({ruleId: 'r', kind: 'fail'}, rules)).toBe('error');
    expect(statusOf({ruleId: 'r'}, rules)).toBe('error');
  });

  it('explains every square it draws, and never with an empty tooltip', () => {
    const rules = [{id: 'r', defaultConfiguration: {level: 'error'}}];
    const titles = [
      {ruleId: 'r'},
      {ruleId: 'r', level: 'warning'},
      {ruleId: 'r', level: 'note'},
      {ruleId: 'r', kind: 'pass'},
      {ruleId: 'r', level: 'none'},
      {}
    ].map((result) => findingStatusTitle(result, resolveResultSeverity(result, rules)));
    titles.forEach((title) => expect(typeof title === 'string' && title.length).toBeTruthy());
    expect(titles[3]).toMatch(/pass/);
    expect(titles[3]).toMatch(/not counted/i);
  });
});

describe('#112 a badge is marked assigned only when nobody but a human named it', () => {
  // The interface contract: applyMappings accumulates into `assigned` ONLY the
  // findings whose attribution came solely from a mapping, and keeps
  // assigned[bucket] <= [bucket]. So "show this as assigned" is "the two are
  // equal", not "assigned is non-empty".
  it('does not claim a half-mapped weakness was never tool-reported', () => {
    // The reproduction: the tool publishes CWE-79 for rule `a`, a manager
    // assigns CWE-79 to unclassified rule `b`, both fire once.
    const rows = cweBadgeRows({'CWE-79': {violations: 1, warnings: 1, notes: 0, assigned: {violations: 0, warnings: 1, notes: 0}}});
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].assigned).toBe(false);
  });

  it('marks a wholly human-sourced weakness as assigned', () => {
    const rows = cweBadgeRows({'CWE-95': {violations: 4, warnings: 0, notes: 0, assigned: {violations: 4, warnings: 0, notes: 0}}});
    expect(rows[0].assigned).toBe(true);
    expect(rows[0].count).toBe(4);
  });

  it('checks every bucket, not just the total', () => {
    const partly = cweBadgeRows({'CWE-1': {violations: 1, warnings: 1, notes: 0, assigned: {violations: 0, warnings: 1, notes: 0}}});
    expect(partly[0].assigned).toBe(false);
    const wholly = cweBadgeRows({'CWE-1': {violations: 1, warnings: 1, notes: 0, assigned: {violations: 1, warnings: 1, notes: 0}}});
    expect(wholly[0].assigned).toBe(true);
  });

  it('treats a weakness with no assigned sub-count as tool-reported', () => {
    expect(cweBadgeRows({'CWE-22': {violations: 3, warnings: 0, notes: 0}})[0].assigned).toBe(false);
  });

  it('never marks an empty weakness as assigned', () => {
    const rows = cweBadgeRows({'CWE-0': {violations: 0, warnings: 0, notes: 0, assigned: {violations: 0, warnings: 0, notes: 0}}});
    expect(rows[0].count).toBe(0);
    expect(rows[0].assigned).toBe(false);
  });

  it('orders by finding count, busiest first, then by id', () => {
    const rows = cweBadgeRows({
      'CWE-22': {violations: 1, warnings: 0, notes: 0},
      'CWE-79': {violations: 2, warnings: 1, notes: 0},
      'CWE-11': {violations: 1, warnings: 0, notes: 0}
    });
    expect(rows.map((row) => row.cwe)).toEqual(['CWE-79', 'CWE-11', 'CWE-22']);
  });

  it('carries a pluralised label so no tooltip reads "1 finding(s)"', () => {
    const rows = cweBadgeRows({'CWE-79': {violations: 1, warnings: 0, notes: 0}});
    expect(rows[0].countLabel).toBe('1 finding');
    expect(cweBadgeRows({'CWE-79': {warnings: 2}})[0].countLabel).toBe('2 findings');
  });

  it('survives a missing or malformed map', () => {
    expect(cweBadgeRows(undefined)).toEqual([]);
    expect(cweBadgeRows(null)).toEqual([]);
    expect(cweBadgeRows({'CWE-79': null})[0]).toEqual(
      expect.objectContaining({cwe: 'CWE-79', count: 0, assigned: false}));
  });

  it('is the one rule both surfaces use', () => {
    // The defect was two helpers answering the same question two ways. Pinning
    // the call sites, because a re-inlined `!!counts.assigned` in either file
    // would otherwise go unnoticed by every test here.
    const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');
    ['imports/client/ui/code-tests/tests-details.js',
      'imports/client/ui/module/module-details/module-tests/module-tests.js']
      .forEach((file) => {
        const source = readSourceWithoutComments(file);
        expect(source).toContain('cweBadgeRows');
        expect(source).not.toContain('!!counts.assigned');
      });
  });
});

describe('#112 the tool\'s own word wins a group badge', () => {
  it('demotes a weakness to tool-reported when both name it', () => {
    expect(mergeGroupCwes([{cwe: 'CWE-79', assigned: true}, {cwe: 'CWE-79', assigned: false}]))
      .toEqual([{cwe: 'CWE-79', assigned: false}]);
    expect(mergeGroupCwes([{cwe: 'CWE-79', assigned: false}, {cwe: 'CWE-79', assigned: true}]))
      .toEqual([{cwe: 'CWE-79', assigned: false}]);
  });

  it('keeps a purely assigned weakness marked as assigned, in first-seen order', () => {
    expect(mergeGroupCwes([
      {cwe: 'CWE-89', assigned: false},
      {cwe: 'CWE-95', assigned: true},
      {cwe: 'CWE-95', assigned: true}
    ])).toEqual([{cwe: 'CWE-89', assigned: false}, {cwe: 'CWE-95', assigned: true}]);
  });

  it('ignores empty entries instead of drawing a blank badge', () => {
    expect(mergeGroupCwes([null, {assigned: true}, {cwe: '', assigned: false}])).toEqual([]);
    expect(mergeGroupCwes(undefined)).toEqual([]);
  });
});

describe('#112 prototype-named rule ids are counted like any other', () => {
  // A bare {} as a seen-map means `seen['__proto__']` is the Object prototype -
  // truthy - so a rule with that id was silently dropped from the unclassified
  // count and from the strip it drives. `constructor` and `toString` the same.
  const ruleIdOf = (result) => result.ruleId;
  const isClassified = (result) => !!result.classified;

  it('does not drop a rule named __proto__, constructor or toString', () => {
    const results = [{ruleId: '__proto__'}, {ruleId: 'constructor'}, {ruleId: 'toString'}];
    expect(unclassifiedRuleIds(results, ruleIdOf, isClassified))
      .toEqual(['__proto__', 'constructor', 'toString']);
  });

  it('counts each rule once, in the order it first fired', () => {
    const results = [{ruleId: 'b'}, {ruleId: 'a'}, {ruleId: 'b'}];
    expect(unclassifiedRuleIds(results, ruleIdOf, isClassified)).toEqual(['b', 'a']);
  });

  it('drops a rule the tool or a mapping already classified', () => {
    const results = [{ruleId: 'a', classified: true}, {ruleId: 'b'}];
    expect(unclassifiedRuleIds(results, ruleIdOf, isClassified)).toEqual(['b']);
  });

  it('skips a result no rule can be resolved for', () => {
    expect(unclassifiedRuleIds([{ruleId: 'a'}], () => null, isClassified)).toEqual([]);
    expect(unclassifiedRuleIds(undefined, ruleIdOf, isClassified)).toEqual([]);
  });

  it('asks after a rule\'s weaknesses once, on its first result', () => {
    // Reading a rule's tags is the expensive half and the answer cannot differ
    // between two findings of the same rule. This runs on every repaint of a
    // page that can carry thousands of findings.
    const asked = [];
    unclassifiedRuleIds([{ruleId: 'a'}, {ruleId: 'a'}], ruleIdOf, (result, ruleId) => {
      asked.push(ruleId);
      return false;
    });
    expect(asked).toEqual(['a']);
  });
});

describe('#112 grouping the findings list is prototype-safe too', () => {
  // Same class of bug, same page: a rule id or - far more plausibly - a source
  // path of `__proto__` wrote through to Object.prototype instead of into the
  // map, and the whole group vanished from the list.
  it('groups a rule named __proto__ by rule', () => {
    const groups = groupResultsByRule([{ruleId: '__proto__'}, {ruleId: 'a'}, {ruleId: '__proto__'}]);
    const proto = groups.find((group) => group.ruleId === '__proto__');
    expect(proto).toBeTruthy();
    expect(proto.list).toHaveLength(2);
    expect(groups).toHaveLength(2);
  });

  it('groups a file named __proto__ by file', () => {
    const locationsOf = (result) => result.locations || [{}];
    const results = [
      {locations: [{physicalLocation: {artifactLocation: {uri: '__proto__/x.js'}}}]},
      {locations: [{physicalLocation: {artifactLocation: {uri: '__proto__/x.js'}}}]},
      {locations: [{physicalLocation: {artifactLocation: {uri: 'src/y.js'}}}]}
    ];
    const groups = groupResultsByFile(results, locationsOf);
    const proto = groups.find((group) => group.ruleId === '__proto__/x.js');
    expect(proto).toBeTruthy();
    expect(proto.list).toHaveLength(2);
    expect(proto.isFileGroup).toBe(true);
  });

  it('keeps the busiest group first, as the page always rendered them', () => {
    const groups = groupResultsByRule([{ruleId: 'a'}, {ruleId: 'b'}, {ruleId: 'b'}]);
    expect(groups.map((group) => group.ruleId)).toEqual(['b', 'a']);
  });

  it('files a location that reports no uri under one bucket', () => {
    const groups = groupResultsByFile([{}, {}], () => [{}]);
    expect(groups).toHaveLength(1);
    expect(groups[0].list).toHaveLength(2);
  });
});

describe('#126 an empty CWEs cell says which kind of empty it is', () => {
  // The tests list reads the denormalised rules.byCwe, written from then on with
  // no back-fill, so every historical document rendered a bare "-" that read as
  // "no weaknesses" while its own detail page listed several.
  it('distinguishes "none recorded" from "none found"', () => {
    const missing = emptyCweCellState(false);
    const empty = emptyCweCellState(true);
    expect(missing.title).not.toEqual(empty.title);
    expect(missing.title).toMatch(/not recorded/i);
    expect(missing.title).toMatch(/open/i);
    // ...and the two do not open with the same words: hovering two cells that
    // mean opposite things must not read alike.
    expect(empty.title).toMatch(/CWE/);
    expect(empty.title.slice(0, 8)).not.toEqual(missing.title.slice(0, 8));
  });

  it('gives both states a tooltip, so neither hovers empty', () => {
    [emptyCweCellState(false), emptyCweCellState(true)].forEach((state) => {
      expect(state.title.length).toBeGreaterThan(0);
    });
  });

  it('marks only the unrecorded state for a visible cue', () => {
    expect(emptyCweCellState(false).className).toBeTruthy();
    expect(emptyCweCellState(true).className).toBe('');
  });
});

describe('countLabel pluralises', () => {
  it('agrees with the summary text the same page prints', () => {
    expect(countLabel(0, 'finding', 'findings')).toBe('0 findings');
    expect(countLabel(1, 'finding', 'findings')).toBe('1 finding');
    expect(countLabel(2, 'finding', 'findings')).toBe('2 findings');
  });

  it('reads as a sentence for the unclassified counter', () => {
    expect(countLabel(1, 'rule', 'rules') + ' unclassified').toBe('1 rule unclassified');
    expect(countLabel(3, 'rule', 'rules') + ' unclassified').toBe('3 rules unclassified');
  });

  it('defaults the plural to an -s and copes with rubbish', () => {
    expect(countLabel(2, 'finding')).toBe('2 findings');
    expect(countLabel(undefined, 'finding', 'findings')).toBe('0 findings');
  });
});

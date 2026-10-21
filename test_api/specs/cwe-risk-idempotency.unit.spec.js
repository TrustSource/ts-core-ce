/* eslint-disable no-undef*/
// The user's number-one requirement: re-uploading the same SARIF
// must never create a duplicate Risk, and - AC15, the sharp form of it - must
// perform NO WRITE AT ALL. Not "no duplicate row": no `updateAsync`, so no
// `edited` bump, and no `logevents` entry.
//
// That guarantee is a pure comparison, so it is tested here directly rather than
// through the database. `canonicalSourceRefs` reduces an entry list to positional
// tuples, which makes the comparison immune to BSON key-order round-tripping and
// to any extra key a future writer leaves on an entry.
//
// AC21 (a DDP reconnect re-sending the same reconcile) is the same code path:
// the second run plans exactly the same shape, so it compares equal and writes
// nothing.
const {
  canonicalSourceRefs,
  desiredPrevCount,
  isSourceRefsUnchanged,
  planCweRisks
} = require('../../imports/lib/sarif/cweRiskPlan');

const MODULE_ID = 'aaaaaaaaaaaaaaaaa';

const RUN = {
  tool: {driver: {name: 'semgrep', rules: [
    {id: 'javascript.express.security.audit.xss.direct-response-write',
      properties: {cwe: ['CWE-79: Improper Neutralization of Input During Web Page Generation']},
      defaultConfiguration: {level: 'error'}},
    {id: 'python.lang.security.audit.subprocess-shell-true',
      properties: {tags: ['CWE-78: OS Command Injection']},
      defaultConfiguration: {level: 'warning'}}
  ]}},
  results: [
    {ruleId: 'javascript.express.security.audit.xss.direct-response-write',
      locations: [{physicalLocation: {artifactLocation: {uri: 'src/app/render.js'}}}]},
    {ruleId: 'javascript.express.security.audit.xss.direct-response-write',
      locations: [{physicalLocation: {artifactLocation: {uri: 'src/app/reply.js'}}}]},
    {ruleId: 'python.lang.security.audit.subprocess-shell-true',
      locations: [{physicalLocation: {artifactLocation: {uri: 'tools/deploy.py'}}}]}
  ]
};

// What the reconcile compares: the shape it read out of the stored document
// against the shape the planner just produced.
function shapeOf(risk, prevCount) {
  return {
    sourceRefs: risk.sourceRefs,
    sourceRefsTotal: risk.sourceRefsTotal,
    sourceRefsTruncated: risk.sourceRefsTruncated,
    sourceRefsPrevCount: prevCount
  };
}

function planRisk(run, cwe) {
  const plan = planCweRisks({moduleId: MODULE_ID, documents: [{tool: 'semgrep', run}]});
  return plan.tools[0].risks.find((risk) => risk.cwe === cwe);
}

describe('#129 canonicalSourceRefs - the comparison the no-op decision rests on', () => {
  const entries = [
    {tool: 'semgrep', ruleId: 'xss', uri: 'a.js', level: 'error', count: 2},
    {tool: 'semgrep', ruleId: 'sqli', uri: 'b.js', level: 'warning', count: 1}
  ];

  it('is insensitive to the key order Mongo may hand an entry back in', () => {
    const roundTripped = [
      {count: 2, level: 'error', uri: 'a.js', ruleId: 'xss', tool: 'semgrep'},
      {uri: 'b.js', count: 1, tool: 'semgrep', level: 'warning', ruleId: 'sqli'}
    ];
    expect(canonicalSourceRefs(roundTripped)).toEqual(canonicalSourceRefs(entries));
  });

  it('ignores an extra key a future writer might leave on an entry', () => {
    const decorated = entries.map((entry) => Object.assign({}, entry, {levelLabel: 'violation'}));
    expect(canonicalSourceRefs(decorated)).toEqual(canonicalSourceRefs(entries));
  });

  it('still notices every field that matters', () => {
    const base = canonicalSourceRefs(entries);
    expect(canonicalSourceRefs([entries[1], entries[0]])).not.toEqual(base);
    [{ruleId: 'other'}, {uri: 'c.js'}, {level: 'note'}, {count: 3}, {tool: 'codeql'}]
      .forEach((patch) => {
        const changed = [Object.assign({}, entries[0], patch), entries[1]];
        expect(canonicalSourceRefs(changed)).not.toEqual(base);
      });
  });

  it('treats a missing, null or non-array list as empty', () => {
    const empty = canonicalSourceRefs([]);
    [undefined, null, 'nope', 42, {}].forEach((value) => {
      expect(canonicalSourceRefs(value)).toEqual(empty);
    });
  });

  it('tolerates a null entry inside the stored array', () => {
    expect(() => canonicalSourceRefs([null, undefined])).not.toThrow();
  });
});

describe('#129 isSourceRefsUnchanged - AC15 / AC21', () => {
  it('says unchanged for a byte-identical re-import', () => {
    const first = planRisk(RUN, 'CWE-79');
    const second = planRisk(RUN, 'CWE-79');
    expect(isSourceRefsUnchanged(shapeOf(first, undefined), shapeOf(second, undefined))).toBe(true);
  });

  it('says unchanged when the stored entries come back in a different key order', () => {
    const planned = planRisk(RUN, 'CWE-79');
    const stored = planned.sourceRefs.map((entry) => ({
      count: entry.count, level: entry.level, uri: entry.uri,
      ruleId: entry.ruleId, tool: entry.tool
    }));
    expect(isSourceRefsUnchanged(
      {sourceRefs: stored, sourceRefsTotal: planned.sourceRefsTotal,
        sourceRefsTruncated: planned.sourceRefsTruncated, sourceRefsPrevCount: undefined},
      shapeOf(planned, undefined))).toBe(true);
  });

  it('treats an absent sourceRefsPrevCount and an explicit undefined as the same thing', () => {
    const planned = planRisk(RUN, 'CWE-79');
    const withoutKey = {sourceRefs: planned.sourceRefs, sourceRefsTotal: planned.sourceRefsTotal,
      sourceRefsTruncated: planned.sourceRefsTruncated};
    expect(isSourceRefsUnchanged(withoutKey, shapeOf(planned, undefined))).toBe(true);
  });

  it('notices a changed occurrence list (AC23)', () => {
    const before = planRisk(RUN, 'CWE-79');
    const fewer = JSON.parse(JSON.stringify(RUN));
    fewer.results = fewer.results.slice(1);
    const after = planRisk(fewer, 'CWE-79');
    expect(isSourceRefsUnchanged(shapeOf(before, undefined), shapeOf(after, undefined))).toBe(false);
  });

  it('notices a changed total or truncation flag even when the stored list matches', () => {
    const planned = planRisk(RUN, 'CWE-79');
    expect(isSourceRefsUnchanged(
      shapeOf(planned, undefined),
      {sourceRefs: planned.sourceRefs, sourceRefsTotal: planned.sourceRefsTotal + 1,
        sourceRefsTruncated: false, sourceRefsPrevCount: undefined})).toBe(false);
    expect(isSourceRefsUnchanged(
      shapeOf(planned, undefined),
      {sourceRefs: planned.sourceRefs, sourceRefsTotal: planned.sourceRefsTotal,
        sourceRefsTruncated: true, sourceRefsPrevCount: undefined})).toBe(false);
  });

  it('notices the prevCount going up or coming off', () => {
    const empty = {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false};
    expect(isSourceRefsUnchanged(
      Object.assign({}, empty, {sourceRefsPrevCount: undefined}),
      Object.assign({}, empty, {sourceRefsPrevCount: 5}))).toBe(false);
    expect(isSourceRefsUnchanged(
      Object.assign({}, empty, {sourceRefsPrevCount: 5}),
      Object.assign({}, empty, {sourceRefsPrevCount: undefined}))).toBe(false);
    expect(isSourceRefsUnchanged(
      Object.assign({}, empty, {sourceRefsPrevCount: 0}),
      Object.assign({}, empty, {sourceRefsPrevCount: undefined}))).toBe(false);
  });

  it('is unchanged when the prevCount stays put', () => {
    const empty = {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false,
      sourceRefsPrevCount: 5};
    expect(isSourceRefsUnchanged(empty, Object.assign({}, empty))).toBe(true);
  });
});

describe('#129 desiredPrevCount - the "0 of N still active" number', () => {
  it('is absent while there are findings', () => {
    expect(desiredPrevCount(5, undefined, 3)).toBeUndefined();
    expect(desiredPrevCount(0, 5, 1)).toBeUndefined();
    // Findings come back after an empty reconcile: the banner has to switch off.
    expect(desiredPrevCount(0, 5, 4)).toBeUndefined();
  });

  it('records the prior count on the first empty reconcile (AC24)', () => {
    expect(desiredPrevCount(5, undefined, 0)).toEqual(5);
  });

  it('stays put on the second consecutive empty reconcile', () => {
    // Without this, "0 of 5" resets to "0 of 0" on the next scan and writes a
    // logevent for a change nobody made.
    expect(desiredPrevCount(0, 5, 0)).toEqual(5);
    expect(isSourceRefsUnchanged(
      {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false, sourceRefsPrevCount: 5},
      {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false,
        sourceRefsPrevCount: desiredPrevCount(0, 5, 0)})).toBe(true);
  });

  it('settles on 0 for a Risk that was empty before anything recorded a count', () => {
    expect(desiredPrevCount(0, undefined, 0)).toEqual(0);
    // ...and stays there, so it is a one-time write and never a churn.
    expect(desiredPrevCount(0, 0, 0)).toEqual(0);
  });
});

describe('#129 a full reconcile cycle, as the writer sees it', () => {
  it('re-import -> unchanged; fewer findings -> changed; none -> prevCount recorded', () => {
    const first = planRisk(RUN, 'CWE-79');
    let stored = shapeOf(first, desiredPrevCount(0, undefined, first.sourceRefs.length));
    expect(stored.sourceRefsPrevCount).toBeUndefined();

    // 1. Byte-identical re-import (AC15) and a DDP retry of it (AC21).
    const again = planRisk(RUN, 'CWE-79');
    expect(isSourceRefsUnchanged(stored,
      shapeOf(again, desiredPrevCount(stored.sourceRefsTotal, stored.sourceRefsPrevCount,
        again.sourceRefs.length)))).toBe(true);

    // 2. A newer document where one of the two occurrences is gone (AC23).
    const newer = JSON.parse(JSON.stringify(RUN));
    newer.results = newer.results.filter((res) => res.locations[0].physicalLocation
      .artifactLocation.uri !== 'src/app/reply.js');
    const fewer = planRisk(newer, 'CWE-79');
    const fewerShape = shapeOf(fewer, desiredPrevCount(stored.sourceRefsTotal,
      stored.sourceRefsPrevCount, fewer.sourceRefs.length));
    expect(isSourceRefsUnchanged(stored, fewerShape)).toBe(false);
    expect(fewerShape.sourceRefs.length).toEqual(1);
    stored = fewerShape;

    // 3. The weakness is absent from the next document entirely (AC24). The
    //    reconcile writes an empty list and records what the count had been.
    const goneShape = {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false,
      sourceRefsPrevCount: desiredPrevCount(stored.sourceRefsTotal, stored.sourceRefsPrevCount, 0)};
    expect(goneShape.sourceRefsPrevCount).toEqual(1);
    expect(isSourceRefsUnchanged(stored, goneShape)).toBe(false);
    stored = goneShape;

    // 4. Still absent on the scan after that: no write, no log.
    const stillGone = {sourceRefs: [], sourceRefsTotal: 0, sourceRefsTruncated: false,
      sourceRefsPrevCount: desiredPrevCount(stored.sourceRefsTotal, stored.sourceRefsPrevCount, 0)};
    expect(isSourceRefsUnchanged(stored, stillGone)).toBe(true);
  });
});

/* eslint-disable no-undef*/
// SARIF import reported "Unfinished" for cleanly completed scans and
// counted the tool's declared rule catalog as if those rules had been executed.
//
// runStatus.js is deliberately meteor-free CommonJS so Jest can require it directly
// (same dual-consumption pattern as externalUrl.js).
const {
  getRunStatusCode,
  getFindingsSummary,
  getRunQualityBucket,
  resolveRuleForResult
} = require('../../imports/lib/sarif/runStatus');

// A semgrep `--config auto` catalog: everything the registry loaded, not what ran.
const CATALOG = Array.from({length: 1074}, (_, i) => ({
  id: 'rules.generated.rule-' + i,
  defaultConfiguration: {level: 'error'}
}));

describe('#123 getRunStatusCode - completion is read from invocations[].executionSuccessful', () => {
  it('reports PASSED for a clean scan that carries invocations (the reported case)', () => {
    // `semgrep scan --config auto --sarif` with 0 findings. Before the fix the mere
    // presence of `invocations` was read as "not finished yet" and this said UNFINISHED.
    expect(getRunStatusCode({
      results: [],
      invocations: [{executionSuccessful: true, toolExecutionNotifications: []}],
      tool: {driver: {name: 'Semgrep OSS', rules: CATALOG}}
    })).toEqual('PASSED');
  });

  it('reports FAILED when the tool itself reports an unsuccessful execution', () => {
    // Before the fix a crashed tool was indistinguishable from a clean one.
    expect(getRunStatusCode({
      results: [],
      invocations: [{executionSuccessful: false}],
      tool: {driver: {name: 'Semgrep OSS', rules: CATALOG}}
    })).toEqual('FAILED');
  });

  it('reports FAILED when any invocation of a multi-invocation run was unsuccessful', () => {
    expect(getRunStatusCode({
      results: [],
      invocations: [{executionSuccessful: true}, {executionSuccessful: false}]
    })).toEqual('FAILED');
  });

  it('reports FAILED when findings are present (shares the red "Failed/Findings" state)', () => {
    expect(getRunStatusCode({
      results: [{ruleId: 'rules.generated.rule-1', level: 'error', message: {text: 'x'}}],
      invocations: [{executionSuccessful: true}]
    })).toEqual('FAILED');
  });

  it('still reports PASSED for a clean run from a tool that omits invocations', () => {
    // invocations is optional in SARIF and plenty of emitters skip it. Downgrading
    // those to UNFINISHED would recreate the reported bug for a different set of tools.
    expect(getRunStatusCode({results: [], tool: {driver: {name: 'trivy'}}})).toEqual('PASSED');
  });

  it('reports UNFINISHED only when there is no run to judge', () => {
    expect(getRunStatusCode(null)).toEqual('UNFINISHED');
    expect(getRunStatusCode(undefined)).toEqual('UNFINISHED');
  });

  it('ignores a malformed invocations value instead of throwing', () => {
    expect(getRunStatusCode({results: [], invocations: 'nope'})).toEqual('PASSED');
    expect(getRunStatusCode({results: [], invocations: [null]})).toEqual('PASSED');
  });
});

describe('#123 resolveRuleForResult - ruleIndex 0 is a valid index', () => {
  const rules = [
    {id: 'first-rule', defaultConfiguration: {level: 'warning'}},
    {id: 'second-rule', defaultConfiguration: {level: 'error'}}
  ];

  it('resolves the first catalog entry from ruleIndex 0', () => {
    // `if (result.ruleIndex)` treated index 0 as absent, so every finding on the
    // first declared rule was silently dropped from the counters.
    expect(resolveRuleForResult({ruleIndex: 0}, rules)).toEqual(rules[0]);
  });

  it('resolves later entries from their index', () => {
    expect(resolveRuleForResult({ruleIndex: 1}, rules)).toEqual(rules[1]);
  });

  it('falls back to a ruleId lookup when no index is given', () => {
    expect(resolveRuleForResult({ruleId: 'second-rule'}, rules)).toEqual(rules[1]);
  });

  it('returns null for an out-of-range index, an unknown id or no catalog', () => {
    expect(resolveRuleForResult({ruleIndex: 99}, rules)).toEqual(null);
    expect(resolveRuleForResult({ruleIndex: -1}, rules)).toEqual(null);
    expect(resolveRuleForResult({ruleId: 'nope'}, rules)).toEqual(null);
    expect(resolveRuleForResult({ruleIndex: 0}, undefined)).toEqual(null);
    expect(resolveRuleForResult(null, rules)).toEqual(null);
  });
});

describe('#123 getFindingsSummary - findings counted from byRule, shared by UI and REST', () => {
  const rules = {
    total: 1074,
    violations: 1,
    warnings: 1,
    notes: 0,
    byRule: {
      violations: {'rules___generated___rule-1': 2},
      warnings: {'rules___generated___rule-2': 1},
      notes: {}
    }
  };

  it('sums the per-rule counts into a findings total', () => {
    expect(getFindingsSummary(rules)).toEqual({total: 3, violations: 2, warnings: 1, notes: 0});
  });

  it('returns zeroes for a run with no findings and for missing input', () => {
    const empty = {total: 0, violations: 0, warnings: 0, notes: 0};
    expect(getFindingsSummary({total: 1074, byRule: {violations: {}, warnings: {}, notes: {}}})).toEqual(empty);
    expect(getFindingsSummary(undefined)).toEqual(empty);
    expect(getFindingsSummary({})).toEqual(empty);
  });

  it('ignores non-numeric per-rule values', () => {
    expect(getFindingsSummary({byRule: {violations: {a: 'x', b: 2}}}))
      .toEqual({total: 2, violations: 2, warnings: 0, notes: 0});
  });
});

describe('#123 getRunQualityBucket - the quality bar counts runs, not catalog rules', () => {
  it('counts a clean run as one ok unit rather than 1074 ok rules', () => {
    // The reported case: `rules.total` is the declared catalog, so the old
    // `total - violations - warnings - notes` put 1074 into the green segment.
    expect(getRunQualityBucket({total: 1074, violations: 0, warnings: 0, notes: 0}, 'PASSED'))
      .toEqual('ok');
  });

  it('counts a run with only warning- or note-level findings as a warning', () => {
    // status is FAILED for any run with findings, so severity has to win over it here.
    expect(getRunQualityBucket({total: 1074, violations: 0, warnings: 2, notes: 0}, 'FAILED'))
      .toEqual('warnings');
    expect(getRunQualityBucket({total: 1074, violations: 0, warnings: 0, notes: 1}, 'FAILED'))
      .toEqual('warnings');
  });

  it('counts a run with error-level findings as a violation', () => {
    expect(getRunQualityBucket({total: 1074, violations: 1, warnings: 5, notes: 5}, 'FAILED'))
      .toEqual('violations');
  });

  it('counts an aborted run as a violation even with no classified findings', () => {
    expect(getRunQualityBucket({total: 1074, violations: 0, warnings: 0, notes: 0}, 'FAILED'))
      .toEqual('violations');
  });

  it('tolerates missing counters', () => {
    expect(getRunQualityBucket(undefined, 'PASSED')).toEqual('ok');
    expect(getRunQualityBucket({}, 'FAILED')).toEqual('violations');
  });
});

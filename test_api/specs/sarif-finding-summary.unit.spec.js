/* eslint-disable no-undef*/
// "Create issue" / "Create risk" on a SARIF finding group prefilled a
// description built from counts and file names only, so the rule text shown under
// every finding in the list never reached the created issue or risk.
//
// findingSummary.js is deliberately meteor-free CommonJS so Jest can require it
// directly (same dual-consumption pattern as runStatus.js).
const {
  buildFindingSummary,
  findingLocations,
  resolveResultMessage,
  resolveRuleText,
  MAX_FILES
} = require('../../imports/lib/sarif/findingSummary');

// A semgrep-shaped catalog entry: shortDescription is the useless "Semgrep
// Finding: <id>" form, the readable text lives in fullDescription/help.
const SEMGREP_RULE = {
  id: 'javascript.lang.security.detect-child-process.detect-child-process',
  name: 'javascript.lang.security.detect-child-process.detect-child-process',
  shortDescription: {text: 'Semgrep Finding: javascript.lang.security.detect-child-process.detect-child-process'},
  fullDescription: {text: 'Detected calls to child_process from a function argument `cmd`. This could lead to a command injection if the input is user controllable.'},
  help: {text: 'Detected calls to child_process ... References: https://owasp.org'},
  defaultConfiguration: {level: 'warning'},
  helpUri: 'https://semgrep.dev/r/javascript.lang.security.detect-child-process.detect-child-process'
};

function findingOn(ruleId, uri, extra) {
  return Object.assign({
    ruleId,
    message: {text: 'The result.'},
    locations: [{physicalLocation: {artifactLocation: {uri}, region: {startLine: 4}}}]
  }, extra || {});
}

describe('#127 resolveResultMessage - the text the findings list shows', () => {
  it('uses the message the result carries when the tool ships no rule catalog', () => {
    // The reported document: tool.driver has name/version and no `rules`.
    expect(resolveResultMessage(findingOn('TUT1001', 'code/example.cs'), null))
      .toEqual('The result.');
  });

  it('fills the rule message template with the result arguments', () => {
    const rules = [{id: 'R1', messageStrings: {default: {text: 'Unsafe call to {0} in {1}'}}}];
    const result = {ruleId: 'R1', message: {arguments: ['exec', 'run.js']}};
    expect(resolveResultMessage(result, rules)).toEqual('Unsafe call to exec in run.js');
  });

  it('leaves placeholders standing when the result carries no arguments', () => {
    // This threw before the fix (`args[index]` on undefined), taking the whole
    // findings list down with it.
    const rules = [{id: 'R1', messageStrings: {default: {text: 'Unsafe call to {0}'}}}];
    expect(resolveResultMessage({ruleId: 'R1', message: {}}, rules))
      .toEqual('Unsafe call to {0}');
  });

  it('resolves a rule referenced by ruleIndex 0', () => {
    const rules = [{id: 'R0', messageStrings: {default: {text: 'first rule fired'}}}];
    expect(resolveResultMessage({ruleIndex: 0, message: {text: 'raw'}}, rules))
      .toEqual('first rule fired');
  });

  it('returns an empty string rather than throwing on a result with no message', () => {
    expect(resolveResultMessage({ruleId: 'R1'}, null)).toEqual('');
    expect(resolveResultMessage(null, null)).toEqual('');
  });
});

describe('#127 resolveRuleText - what a reviewer has to read', () => {
  it('prefers the catalog fullDescription over the "Semgrep Finding" short form', () => {
    expect(resolveRuleText(findingOn(SEMGREP_RULE.id, 'run.js'), [SEMGREP_RULE]))
      .toEqual(SEMGREP_RULE.fullDescription.text);
  });

  it('falls back to help.text, then shortDescription', () => {
    const noFull = Object.assign({}, SEMGREP_RULE, {fullDescription: undefined});
    expect(resolveRuleText(findingOn(SEMGREP_RULE.id, 'run.js'), [noFull]))
      .toEqual(SEMGREP_RULE.help.text);
    const onlyShort = Object.assign({}, noFull, {help: undefined});
    expect(resolveRuleText(findingOn(SEMGREP_RULE.id, 'run.js'), [onlyShort]))
      .toEqual(SEMGREP_RULE.shortDescription.text);
  });

  it('falls back to the result message when there is no catalog', () => {
    expect(resolveRuleText(findingOn('TUT1001', 'code/example.cs'), null))
      .toEqual('The result.');
  });

  it('truncates a very long rule text instead of building an unbounded body', () => {
    const long = {id: 'R1', fullDescription: {text: 'word '.repeat(1000)}};
    const text = resolveRuleText({ruleId: 'R1'}, [long]);
    expect(text.length).toBeLessThanOrEqual(1204);
    expect(text.endsWith('...')).toBe(true);
  });
});

describe('#127 buildFindingSummary - By Rule', () => {
  const group = {
    ruleId: SEMGREP_RULE.id,
    list: [
      findingOn(SEMGREP_RULE.id, 'infrastructure/lambdas/feedback-service/run.js'),
      findingOn(SEMGREP_RULE.id, 'infrastructure/lambdas/other/run.js', {level: 'error'})
    ]
  };

  it('carries the rule text, which is what the report was about', () => {
    const summary = buildFindingSummary(group, {toolName: 'Semgrep OSS', rules: [SEMGREP_RULE]});
    expect(summary.text).toContain(SEMGREP_RULE.fullDescription.text);
  });

  it('names the tool from the run rather than the "Test" fallback', () => {
    const summary = buildFindingSummary(group, {toolName: 'Semgrep OSS', rules: [SEMGREP_RULE]});
    expect(summary.title).toEqual('[Semgrep OSS] ' + SEMGREP_RULE.id);
  });

  it('keeps the rule coordinates, severity, reference and file list', () => {
    const summary = buildFindingSummary(group, {toolName: 'Semgrep OSS', rules: [SEMGREP_RULE]});
    expect(summary.text).toContain('Rule: ' + SEMGREP_RULE.id);
    expect(summary.text).toContain('Severity: warning');
    expect(summary.text).toContain('Reference: ' + SEMGREP_RULE.helpUri);
    expect(summary.text).toContain('2 findings for rule ' + SEMGREP_RULE.id);
    expect(summary.text).toContain('- infrastructure/lambdas/feedback-service/run.js');
    expect(summary.text).toContain('- infrastructure/lambdas/other/run.js');
  });

  it('reads severity off the result when it states one', () => {
    const onlyLevelled = {ruleId: 'R1', list: [findingOn('R1', 'a.js', {level: 'error'})]};
    expect(buildFindingSummary(onlyLevelled, {toolName: 'semgrep'}).text)
      .toContain('Severity: error');
  });

  it('says "1 finding" for a single hit', () => {
    const single = {ruleId: 'TUT1001', list: [findingOn('TUT1001', 'code/example.cs')]};
    const summary = buildFindingSummary(single, {toolName: 'semgrep'});
    expect(summary.title).toEqual('[semgrep] TUT1001');
    expect(summary.text).toContain('The result.');
    expect(summary.text).toContain('1 finding for rule TUT1001');
    expect(summary.text).not.toContain('1 findings');
  });

  it('caps the file list and says how many were left out', () => {
    const many = {
      ruleId: 'R1',
      list: Array.from({length: MAX_FILES + 7}, (_, i) => findingOn('R1', 'src/file-' + i + '.js'))
    };
    const summary = buildFindingSummary(many, {toolName: 'semgrep'});
    expect(summary.text).toContain('- ... and 7 more');
    expect(summary.text).toContain(String(MAX_FILES + 7) + ' findings for rule R1');
  });

  it('deduplicates files hit more than once by the same rule', () => {
    const repeated = {
      ruleId: 'R1',
      list: [findingOn('R1', 'a.js'), findingOn('R1', 'a.js'), findingOn('R1', 'b.js')]
    };
    const files = buildFindingSummary(repeated, {toolName: 'semgrep'}).text.split('Files:\n')[1];
    expect(files.split('\n')).toEqual(['- a.js', '- b.js']);
  });

  it('omits the Files section for findings that carry no location', () => {
    const noLocation = {ruleId: 'R1', list: [{ruleId: 'R1', message: {text: 'no location'}}]};
    const summary = buildFindingSummary(noLocation, {toolName: 'semgrep'});
    expect(summary.text).toContain('no location');
    expect(summary.text).not.toContain('Files:');
  });
});

describe('#127 buildFindingSummary - By File', () => {
  it('names what each rule complained about instead of listing bare ids', () => {
    const group = {
      isFileGroup: true,
      ruleId: 'infrastructure/lambdas/feedback-service/run.js',
      list: [
        findingOn(SEMGREP_RULE.id, 'infrastructure/lambdas/feedback-service/run.js'),
        findingOn('OTHER1002', 'infrastructure/lambdas/feedback-service/run.js')
      ]
    };
    const summary = buildFindingSummary(group, {toolName: 'Semgrep OSS', rules: [SEMGREP_RULE]});
    expect(summary.title).toEqual('[Semgrep OSS] infrastructure/lambdas/feedback-service/run.js');
    expect(summary.text).toContain('2 findings in infrastructure/lambdas/feedback-service/run.js');
    expect(summary.text).toContain('- ' + SEMGREP_RULE.id + ': ' + SEMGREP_RULE.fullDescription.text);
    // no catalog entry - the result's own message stands in
    expect(summary.text).toContain('- OTHER1002: The result.');
  });

  it('lists each rule once even when it fired repeatedly in the file', () => {
    const group = {
      isFileGroup: true,
      ruleId: 'a.js',
      list: [findingOn('R1', 'a.js'), findingOn('R1', 'a.js')]
    };
    const rulesBlock = buildFindingSummary(group, {toolName: 'semgrep'}).text.split('Rules:\n')[1];
    expect(rulesBlock.split('\n')).toEqual(['- R1: The result.']);
  });
});

describe('#127 buildFindingSummary - degenerate input', () => {
  it('does not throw on a missing group or an empty list', () => {
    expect(buildFindingSummary(null, {toolName: 'semgrep'}).text).toEqual('');
    expect(buildFindingSummary({ruleId: 'R1'}, {toolName: 'semgrep'}).text)
      .toContain('0 findings for rule R1');
  });

  it('keeps the historical "Test" placeholder when no tool name is known', () => {
    expect(buildFindingSummary({ruleId: 'R1', list: []}, {}).title).toEqual('[Test] R1');
  });
});

// The findings list and the By File grouping both walk `result.locations`, which
// SARIF 2.1.0 3.27.12 makes optional. A run of location-less results rendered a
// group header with a count above an empty panel body, and vanished from By File
// entirely - the page went blank while the counter still said 3.
describe('#127 findingLocations - results that carry no location', () => {
  it('hands back a single placeholder so the finding still gets a row', () => {
    // The shape the /tests REST spec uploads: message text, no locations.
    expect(findingLocations({ruleId: 'rules.test.error-rule', message: {text: 'finding one'}}))
      .toEqual([{}]);
    expect(findingLocations({ruleId: 'R1', locations: []})).toEqual([{}]);
    expect(findingLocations(null)).toEqual([{}]);
  });

  it('hands back the real locations untouched when there are any', () => {
    const locations = [{physicalLocation: {artifactLocation: {uri: 'a.js'}}}];
    expect(findingLocations({ruleId: 'R1', locations})).toBe(locations);
  });

  it('leaves the placeholder without a uri, so By File buckets it under "unknown"', () => {
    const [placeholder] = findingLocations({ruleId: 'R1'});
    const uri = placeholder.physicalLocation && placeholder.physicalLocation.artifactLocation &&
      placeholder.physicalLocation.artifactLocation.uri || 'unknown';
    expect(uri).toEqual('unknown');
  });

  it('still summarises a location-less group, without a Files section', () => {
    const group = {
      ruleId: 'rules.test.error-rule',
      list: [
        {ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding one'}},
        {ruleId: 'rules.test.error-rule', level: 'error', message: {text: 'finding two'}}
      ]
    };
    const summary = buildFindingSummary(group, {toolName: 'semgrep'});
    expect(summary.text).toContain('finding one');
    expect(summary.text).toContain('2 findings for rule rules.test.error-rule');
    expect(summary.text).not.toContain('Files:');
  });
});

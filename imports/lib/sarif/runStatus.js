// SARIF run interpretation.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as externalUrl.js. Imported by the shared
// Utils facade, the import interactor, the REST read API and the Blaze cells, so
// all four report the same numbers for the same document.

// `run.invocations[].executionSuccessful` is the tool's own verdict on whether the
// run completed - SARIF has no other field for it. Its mere presence means the
// opposite of "unfinished": the tool got far enough to describe how it finished.
//
// Vocabulary is the existing one (the status filter offers Passed / Unfinished /
// Failed-Findings), so a crashed tool and a run with findings share the red state:
//   PASSED     - the run completed and reported nothing
//   FAILED     - the tool reported an unsuccessful execution, or there are findings
//   UNFINISHED - there is no run to judge
//
// A run without `invocations` stays PASSED: the array is optional in SARIF and
// many emitters omit it, so treating its absence as "unfinished" would recreate
// the reported bug for those tools instead of fixing it.
function getRunStatusCode(run) {
  if (!run) {
    return 'UNFINISHED';
  }
  const invocations = Array.isArray(run.invocations) ? run.invocations : [];
  if (invocations.some((inv) => inv && inv.executionSuccessful === false)) {
    return 'FAILED';
  }
  if (run.results && run.results.length > 0) {
    return 'FAILED';
  }
  return 'PASSED';
}

// Every catalog entry a run declares, driver first.
//
// `tool.driver.rules` is not the whole catalog. Current CodeQL leaves it EMPTY
// and ships its queries - and with them every `external/cwe/...` tag and every
// defaultConfiguration.level - inside `tool.extensions[].rules`, pointing at
// them with `result.rule.{index, toolComponent.index}` instead of `ruleIndex`.
// Reading only the driver meant a real CodeQL upload resolved no rule at all,
// so none of its results were counted and the document reported zero findings.
//
// Driver entries stay first so an existing driver-relative `result.ruleIndex`
// still lands on the same entry it always did.
//
// A sanity cap, because the catalogue is attacker-controlled and this runs on
// the import path. `rules.push(...extension.rules)` spreads the array into
// arguments and throws RangeError at roughly 130k of them - reachable from a
// ~1.5 MB document, well inside the 5 MB body limit - so the entries are
// appended one at a time and the total is bounded. The real catalogues this
// reads are three orders of magnitude smaller: CodeQL ships a few thousand
// queries and `semgrep --config auto` around ten thousand rules.
const MAX_CATALOG_RULES = 50000;

function collectRules(run) {
  const driver = run && run.tool && run.tool.driver;
  const declared = driver && Array.isArray(driver.rules) ? driver.rules : [];
  const rules = declared.slice(0, MAX_CATALOG_RULES);
  const extensions = run && run.tool && Array.isArray(run.tool.extensions) ?
    run.tool.extensions : [];
  for (const extension of extensions) {
    if (!extension || !Array.isArray(extension.rules)) {
      continue;
    }
    for (const rule of extension.rules) {
      if (rules.length >= MAX_CATALOG_RULES) {
        return rules;
      }
      rules.push(rule);
    }
  }
  return rules;
}

// Locates the catalog entry a result refers to. `ruleIndex` is 0-based, so it has
// to be tested for being a number - a plain truthiness check drops every finding
// on the first declared rule.
function resolveRuleForResult(result, rules) {
  if (!result || !Array.isArray(rules) || rules.length === 0) {
    return null;
  }
  if (typeof result.ruleIndex === 'number' && result.ruleIndex >= 0) {
    return rules[result.ruleIndex] || null;
  }
  // `result.rule` is the reporting descriptor reference an extension-hosted rule
  // is named by; its `index` is relative to that toolComponent, not to this flat
  // list, so the id is what can be matched safely.
  const ruleId = result.ruleId || (result.rule && result.rule.id);
  if (ruleId) {
    return rules.find((rule) => rule && rule.id === ruleId) || null;
  }
  return null;
}

// The severity and rule a result should be counted under.
//
// `kind` is asked FIRST, because it is what decides whether the result is a
// finding at all. SARIF 2.1.0 (3.27.10): with any kind other than `fail`, an
// absent level defaults to `none` and a present one SHALL be `none` - so a
// `pass`, `informational`, `notApplicable`, `review` or `open` result is never
// counted, whatever the catalogue entry declares as its default level. Asking
// the rule default first left that guard dead for exactly the tools that matter:
// every CodeQL and semgrep rule declares `defaultConfiguration.level`, and since
// collectRules learned to read the extension-hosted CodeQL catalogue those
// defaults now resolve, so non-failing results were inheriting `error`.
//
// For a failing result the level is what the result states, else the catalogue
// entry's default, else `warning` - SARIF's own default, not a guess. Treating
// the absence as "uncountable" lost every finding from tools that simply do not
// write the property, Bandit among them.
function resolveResultSeverity(result, rules) {
  const kind = (result && result.kind) || 'fail';
  if (kind !== 'fail') {
    return null;
  }
  const rule = resolveRuleForResult(result, rules);
  const level = (result && result.level) ||
    (rule && rule.defaultConfiguration && rule.defaultConfiguration.level) ||
    'warning';
  const ruleId = (result && result.ruleId) || (result && result.rule && result.rule.id) ||
    (rule && rule.id);
  return level && ruleId ? {level, ruleId} : null;
}

// hasOwnProperty rather than a truthiness check on the key: a SARIF rule id is
// attacker-controlled and `toString` / `valueOf` / `constructor` are inherited
// members of any plain object, so an unguarded for...in would fold a function
// into the sum (as NaN) for a document that never declared such a rule.
function sumRuleCounts(byRuleMap) {
  let sum = 0;
  for (const ruleId in byRuleMap) {
    if (ruleId && Object.prototype.hasOwnProperty.call(byRuleMap, ruleId)) {
      sum += +byRuleMap[ruleId] || 0;
    }
  }
  return sum;
}

// Finding counts per severity. The import counts every SARIF result per rule in
// rules.byRule, so the per-rule sums give the number of findings - as opposed to
// rules.violations/warnings/notes, which count the distinct rules that fired.
function getFindingsSummary(rules) {
  const byRule = (rules && rules.byRule) || {};
  const violations = sumRuleCounts(byRule.violations);
  const warnings = sumRuleCounts(byRule.warnings);
  const notes = sumRuleCounts(byRule.notes);
  return {total: violations + warnings + notes, violations, warnings, notes};
}

// Which segment of the per-tool quality bar a single run belongs to. The bar counts
// runs: SARIF reports no count of rules that ran and stayed silent, and
// `tool.driver.rules` is the tool's declared catalog - for `semgrep --config auto`
// the whole loaded registry - so an "ok" figure derived from it measured nothing.
function getRunQualityBucket(rules, status) {
  const counts = rules || {};
  if ((counts.violations || 0) > 0) {
    return 'violations';
  }
  if ((counts.warnings || 0) > 0 || (counts.notes || 0) > 0) {
    return 'warnings';
  }
  // Either the tool aborted or it reported findings none of the counters could
  // classify; both mean this run is not a clean one.
  if (status === 'FAILED') {
    return 'violations';
  }
  return 'ok';
}

module.exports = {
  MAX_CATALOG_RULES,
  collectRules,
  getRunQualityBucket,
  getRunStatusCode,
  resolveRuleForResult,
  resolveResultSeverity,
  getFindingsSummary,
  sumRuleCounts
};

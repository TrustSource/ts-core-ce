// "Create issue" / "Create risk" on a SARIF finding group produced a
// description made of counts and file names only. The rule text a reviewer needs
// to judge the finding - the very text the findings list prints under each hit -
// never reached the GitHub issue or the risk.
//
// meteor-free CommonJS so Jest can require it directly, the same dual-consumption
// pattern as runStatus.js.

const {resolveRuleForResult} = require('./runStatus');
const {extractRuleCwes} = require('./cweExtract');

// A rule that fired on hundreds of files would otherwise build a description
// GitHub rejects; the counts above the list still report the real total.
const MAX_FILES = 50;
// Full rule text for the single-rule case, a short lead-in per rule when a file
// group lists many of them.
const MAX_RULE_TEXT = 1200;
const MAX_RULE_TEXT_IN_LIST = 300;

// SARIF message strings interpolate positional {0}/{1} placeholders from
// `result.message.arguments`. That array is optional, so a missing or short one
// has to leave the placeholder standing instead of throwing.
function replacePlaceholders(template, args) {
  const list = Array.isArray(args) ? args : [];
  return String(template).replace(/\{(\d+)\}/g, (match, index) => {
    const value = list[Number(index)];
    return value === undefined || value === null ? match : String(value);
  });
}

// SARIF wraps every human-readable string in a {text, markdown} object.
function plainText(node) {
  return node && typeof node.text === 'string' && node.text.trim() ? node.text.trim() : '';
}

function truncate(value, max) {
  if (!value || value.length <= max) {
    return value || '';
  }
  // Cut on a word boundary when there is one close to the limit; indexOf rather
  // than a trailing-whitespace regex, which backtracks badly on long text.
  const clipped = value.slice(0, max);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > max / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd() + '...';
}

// The finding text exactly as the findings list renders it: the rule's message
// template filled with this result's arguments, or the message the result carries
// itself when the tool ships no catalog.
function resolveResultMessage(result, rules) {
  const rule = resolveRuleForResult(result, rules);
  const template = rule && rule.messageStrings && plainText(rule.messageStrings.default);
  if (template) {
    return replacePlaceholders(template, result && result.message && result.message.arguments);
  }
  return (result && plainText(result.message)) || '';
}

// What a reviewer has to read to understand why the rule fired. The catalog's
// long forms come first; `shortDescription` is often just "<tool> Finding: <id>",
// and for tools that ship no `tool.driver.rules` at all the result's own message
// is the only text there is.
function resolveRuleText(result, rules, max) {
  const rule = resolveRuleForResult(result, rules);
  const fromCatalog = rule && (plainText(rule.fullDescription) || plainText(rule.help) ||
    plainText(rule.shortDescription));
  return truncate(fromCatalog || resolveResultMessage(result, rules), max || MAX_RULE_TEXT);
}

// `result.locations` is optional in SARIF 2.1.0 (3.27.12): a finding that is not
// tied to an artifact - project-wide, configuration-level, or a tool that simply
// omits the array - legitimately carries none. Views that iterate the list have to
// keep rendering one row for the finding itself, so hand back a single empty
// placeholder rather than an empty list.
function findingLocations(result) {
  const locations = result && result.locations;
  return Array.isArray(locations) && locations.length ? locations : [{}];
}

function resultsOf(group) {
  return Array.isArray(group && group.list) ? group.list : [];
}

function fileOfLocation(location) {
  const physical = location && location.physicalLocation;
  return (physical && physical.artifactLocation && physical.artifactLocation.uri) || '';
}

function uniqueFiles(results) {
  const files = [];
  results.forEach((result) => {
    const locations = Array.isArray(result && result.locations) ? result.locations : [];
    locations.forEach((location) => {
      const uri = fileOfLocation(location);
      if (uri && files.indexOf(uri) === -1) {
        files.push(uri);
      }
    });
  });
  return files;
}

function bulletList(items, max) {
  const lines = items.slice(0, max).map((item) => '- ' + item);
  if (items.length > max) {
    lines.push('- ... and ' + (items.length - max) + ' more');
  }
  return lines.join('\n');
}

function findingCount(count) {
  return count + (count === 1 ? ' finding' : ' findings');
}

function buildTitle(toolName, subject) {
  return '[' + (toolName || 'Test') + '] ' + subject;
}

// One rule, N hits: lead with the rule text, then the rule's own coordinates, then
// where it fired.
function buildRuleGroupSummary(group, options) {
  const rules = options.rules;
  const results = resultsOf(group);
  // Carry ruleIndex when there is a result to read it from - it is how SARIF
  // points at the catalog entry, and it is 0-based.
  const sample = results[0] || {ruleId: group.ruleId};
  const rule = resolveRuleForResult(sample, rules);
  const level = (sample && sample.level) ||
    (rule && rule.defaultConfiguration && rule.defaultConfiguration.level) || '';
  const helpUri = (rule && rule.helpUri) || '';
  const files = uniqueFiles(results);

  const sections = [];
  const ruleText = resolveRuleText(sample, rules);
  if (ruleText) {
    sections.push(ruleText);
  }
  // The weaknesses the tool attributed to this rule. Carried into the
  // created issue's body and, for a risk, into its own CWE field - so a SAST
  // finding arrives typed instead of as untyped prose.
  const cwes = extractRuleCwes(rule);
  const meta = ['Rule: ' + group.ruleId];
  if (level) {
    meta.push('Severity: ' + level);
  }
  if (cwes.length) {
    meta.push('CWE: ' + cwes.join(', '));
  }
  if (helpUri) {
    meta.push('Reference: ' + helpUri);
  }
  sections.push(meta.join('\n'));
  sections.push(findingCount(results.length) + ' for rule ' + group.ruleId);
  if (files.length) {
    sections.push('Files:\n' + bulletList(files, MAX_FILES));
  }

  return {title: buildTitle(options.toolName, group.ruleId), text: sections.join('\n\n'), cwes};
}

// One file, N rules: the rule text belongs next to each rule id, so the list says
// what every rule complained about instead of repeating identifiers.
function buildFileGroupSummary(group, options) {
  const rules = options.rules;
  const results = resultsOf(group);
  const seen = [];
  const cwes = [];
  results.forEach((result) => {
    const rule = resolveRuleForResult(result, rules);
    const ruleId = (result && result.ruleId) || (rule && rule.id) || 'unknown';
    // Union across the file's rules: the risk this becomes covers the file, so
    // it carries every weakness found in it.
    extractRuleCwes(rule).forEach((cwe) => {
      if (cwes.indexOf(cwe) === -1) {
        cwes.push(cwe);
      }
    });
    if (!seen.some((entry) => entry.ruleId === ruleId)) {
      seen.push({ruleId, cwes: extractRuleCwes(rule),
        text: resolveRuleText(result, rules, MAX_RULE_TEXT_IN_LIST)});
    }
  });

  const sections = [findingCount(results.length) + ' in ' + group.ruleId];
  if (cwes.length) {
    sections.push('CWE: ' + cwes.join(', '));
  }
  if (seen.length) {
    sections.push('Rules:\n' + seen
      .map((entry) => entry.ruleId + (entry.cwes.length ? ' (' + entry.cwes.join(', ') + ')' : '') +
        (entry.text ? ': ' + entry.text : ''))
      .map((line) => '- ' + line)
      .join('\n'));
  }

  return {title: buildTitle(options.toolName, group.ruleId), text: sections.join('\n\n'), cwes};
}

// `group` is what the testsDetails `resultsGrouped` helper produces: {ruleId, list}
// for the By Rule view, plus isFileGroup:true and a file path in `ruleId` for By File.
function buildFindingSummary(group, options) {
  const opts = options || {};
  if (!group) {
    return {title: buildTitle(opts.toolName, ''), text: '', cwes: []};
  }
  return group.isFileGroup ?
    buildFileGroupSummary(group, opts) :
    buildRuleGroupSummary(group, opts);
}

module.exports = {
  buildFindingSummary,
  fileOfLocation,
  findingLocations,
  resolveResultMessage,
  resolveRuleText,
  MAX_FILES,
  MAX_RULE_TEXT
};

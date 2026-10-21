// CWE extraction from a SARIF run.
//
// CVEs arrive per module from the vulnerability report; SAST findings did not, because nothing
// read the weakness ids out of the SARIF a tool uploaded. This module is that
// reader, and the counts it produces are what `findings.cwes` reports.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as runStatus.js and findingSummary.js. Consumed by
// the import interactor, the REST read API and the Blaze findings list, so all
// three name the same weakness the same way.

const {collectRules, resolveRuleForResult, resolveResultSeverity} = require('./runStatus');

// THREE PLACES, BECAUSE THE TOOLS DISAGREE
//
// There is no single field. Of the documents this had to read:
//   - CodeQL puts `external/cwe/cwe-079` in `properties.tags`
//   - older semgrep puts `CWE-601: URL Redirection...` in `properties.tags`
//   - newer semgrep OSS (and Snyk Code) ship no `tags` and use `properties.cwe`
//   - the SARIF spec's own mechanism is `relationships` into a CWE taxonomy
// Reading only `tags` returns nothing for a whole class of uploads, so all
// three are tried and unioned.

// Leading id only. The tag text after the id is prose, and it quotes other
// weaknesses: "CWE-120: Does not check for buffer overflows (CWE-120, CWE-20)"
// and "CWE-22: chroot ... is hard to use correctly (CWE-250)" are both real.
// Scanning the whole string would assert a CWE-20 / CWE-250 link the tool never
// made, which is the guessing this feature is not allowed to do.
const CWE_AT_START = /^\s*(?:external\/cwe\/)?cwe[-_:\s]?(\d+)\b/i;

// `CWE-022` and `CWE-22` are the same weakness - CodeQL pads to three digits and
// everything else in TrustSource (cweVulnType.js's table, the CVE-side ids the
// viewer renders beside these) writes it unpadded. Left alone the padded form
// silently joins up with nothing, so the number is parsed and reprinted rather
// than the string being passed through.
//
// Number.isSafeInteger, not Number.isFinite: `parseInt` of a long run of digits
// overflows to a float, and `'CWE-' + 1e21` is the string `CWE-1e+21`. That
// passes every truthiness check here and then fails the collection schema's
// /^CWE-\d+$/ deep inside collection2, so the free-text Assign CWE field
// answered an opaque validation error where the interactor meant to answer
// 400 "A valid CWE id is required". An id this far out of range is not a
// weakness id at all, so it is refused here instead.
function normalizeCwe(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const match = raw.match(CWE_AT_START);
  if (!match) {
    return null;
  }
  const id = parseInt(match[1], 10);
  return Number.isSafeInteger(id) ? 'CWE-' + id : null;
}

function pushUnique(list, cwe) {
  if (cwe && list.indexOf(cwe) === -1) {
    list.push(cwe);
  }
}

// `properties.cwe` is an array in every sample seen, but a bare string costs
// nothing to accept and one tool emitting the singular form would otherwise
// lose all of its weaknesses.
function fromPropertyCwe(properties, out) {
  const value = properties && properties.cwe;
  if (typeof value === 'string') {
    pushUnique(out, normalizeCwe(value));
  } else if (Array.isArray(value)) {
    value.forEach((entry) => pushUnique(out, normalizeCwe(entry)));
  }
}

// Non-string entries are skipped rather than coerced: semgrep/semgrep#4673
// shipped arrays inside `tags`, which is invalid SARIF, and String([...]) would
// turn one into a plausible-looking match.
function fromTags(properties, out) {
  const tags = properties && properties.tags;
  if (!Array.isArray(tags)) {
    return;
  }
  tags.forEach((tag) => {
    if (typeof tag === 'string') {
      pushUnique(out, normalizeCwe(tag));
    }
  });
}

// The spec's own route: rule.relationships[].target points at a taxa entry, and
// for the CWE taxonomy that entry's id is the weakness number. Matched on the
// target id alone - a taxonomy the run does not declare is still readable, and
// anything that is not CWE-shaped fails normalizeCwe and is dropped.
function fromRelationships(rule, out) {
  const relationships = rule && rule.relationships;
  if (!Array.isArray(relationships)) {
    return;
  }
  relationships.forEach((relationship) => {
    const target = relationship && relationship.target;
    if (target) {
      pushUnique(out, normalizeCwe(target.id));
    }
  });
}

// Every weakness one catalog entry declares, deduped and in the order the tool
// listed them. An empty array means the rule carries no resolvable CWE - it is
// never filled in from the rule id, the helpUri or the message text.
function extractRuleCwes(rule) {
  if (!rule) {
    return [];
  }
  const out = [];
  fromPropertyCwe(rule.properties, out);
  fromTags(rule.properties, out);
  fromRelationships(rule, out);
  return out;
}

// `ruleIds` records WHICH rules put findings under this weakness. It is the
// attribution cweMappingOverlay needs to tell a weakness the tool published for
// a rule from one a human assigned to the same rule, so that a rule carrying
// both is not counted twice (see applyMappings). Ids are kept raw: an array
// entry is a value, not a Mongo field name, so it needs none of the escaping
// rules.byRule applies to its keys.
function emptyCounts() {
  return {violations: 0, warnings: 0, notes: 0, ruleIds: []};
}

// SARIF level -> the vocabulary the rest of the Tests feature already uses.
// `error` is called a violation here, matching rules.violations and the status
// filter; it is not a CVSS severity.
const BUCKET_BY_LEVEL = {error: 'violations', warning: 'warnings', note: 'notes'};

// The same three, in the order findings.cwes reports them and under the name it
// reports them by.
const REPORTED_LEVELS = [
  {level: 'violation', bucket: 'violations'},
  {level: 'warning', bucket: 'warnings'},
  {level: 'note', bucket: 'notes'}
];

// Findings per weakness per level for one stored run, with the rules that put
// them there:
//   {'CWE-79': {violations: 3, warnings: 0, notes: 1, ruleIds: ['js/xss']}, ...}
//
// Keyed by CWE rather than by rule id on purpose. The sibling rules.byRule map
// has to escape its keys ('.' -> '___') because semgrep rule ids are dotted, and
// that escaping cannot be undone safely; a CWE id has no character Mongo objects
// to, so this map round-trips as itself.
//
// A rule declaring several weaknesses counts its finding under each of them, so
// these counts deliberately do not reconcile with findings.total.
function collectRunCwes(run) {
  const byCwe = {};
  const results = run && Array.isArray(run.results) ? run.results : [];
  if (!results.length) {
    return byCwe;
  }
  const rules = collectRules(run);
  // Cache per catalog entry: a rule that fired 500 times is parsed once.
  //
  // Object.create(null), because the key is a rule id straight out of the
  // uploaded document. On a plain object `cwesByRuleId['constructor']` answers
  // with Object itself - truthy, so the initialiser below is skipped - and the
  // for...of then throws "is not iterable", aborting the whole import. `toString`,
  // `valueOf`, `hasOwnProperty` and `__proto__` behave the same way.
  const cwesByRuleId = Object.create(null);
  for (const result of results) {
    const severity = resolveResultSeverity(result, rules);
    if (!severity) {
      continue;
    }
    const bucket = BUCKET_BY_LEVEL[severity.level];
    if (!bucket) {
      continue;
    }
    if (!cwesByRuleId[severity.ruleId]) {
      cwesByRuleId[severity.ruleId] = extractRuleCwes(resolveRuleForResult(result, rules));
    }
    for (const cwe of cwesByRuleId[severity.ruleId]) {
      // `cwe` is /^CWE-\d+$/ by construction (normalizeCwe), so it can never
      // name a prototype member the way a rule id can.
      if (!byCwe[cwe]) {
        byCwe[cwe] = emptyCounts();
      }
      byCwe[cwe][bucket] += 1;
      if (byCwe[cwe].ruleIds.indexOf(severity.ruleId) === -1) {
        byCwe[cwe].ruleIds.push(severity.ruleId);
      }
    }
  }
  return byCwe;
}

// The stored byCwe map as the flat array `findings.cwes` reports: one entry per
// weakness per level that actually fired, busiest first. A weakness seen at two
// levels appears twice, which is what lets a consumer keep the level and the
// count together without a nested object.
//
// A weakness someone assigned to an unclassified rule is counted here like any
// other, but the response says nothing about where it came from:
// the `assigned` sub-count applyMappings leaves on the map is ours to render a
// badge from, not part of the API contract. The row shape is unchanged from what was
// first published.
function formatCweFindings(byCwe) {
  const rows = [];
  for (const cwe in byCwe) {
    if (!Object.prototype.hasOwnProperty.call(byCwe, cwe)) {
      continue;
    }
    const counts = byCwe[cwe] || {};
    for (const reported of REPORTED_LEVELS) {
      const count = +counts[reported.bucket] || 0;
      if (count > 0) {
        rows.push({cwe, count, level: reported.level});
      }
    }
  }
  // Busiest weakness first; ties by ascending CWE number so the order is stable
  // between requests rather than following object key order.
  rows.sort((a, b) => b.count - a.count ||
    (parseInt(a.cwe.slice(4), 10) - parseInt(b.cwe.slice(4), 10)));
  return rows;
}

// Every distinct weakness in a run, in first-seen order - what the findings list
// header and the tests list column show, and what prefills a risk's CWE field.
function listRunCwes(run) {
  return Object.keys(collectRunCwes(run));
}

module.exports = {
  BUCKET_BY_LEVEL,
  normalizeCwe,
  extractRuleCwes,
  collectRunCwes,
  formatCweFindings,
  listRunCwes
};

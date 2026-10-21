// Manually assigned CWEs, overlaid onto what a tool published.
//
// The SARIF import reads the weakness ids out of a tool's own rule metadata and refuses to
// invent one where the tool published none. That refusal is right - a wrong
// classification is worse than an empty field - but it leaves whole tools whose
// findings can never reach a threat model. So a human closes the gap instead: a
// Security Manager assigns the CWE, and this module applies that assignment
// wherever weaknesses are read.
//
// WHY AN OVERLAY AND NOT A REWRITE
//
// The obvious shape is to resolve the mapping at import, next to the metadata,
// and store the result in rules.byCwe. That makes an assignment invisible until
// the next scan, and makes every stored document stale the moment a mapping
// changes.
//
// Instead nothing is stored. A mapping is keyed by rule, and rules.byRule already
// holds per-rule finding counts on every document ever imported - it predates
// rules.byCwe by years. So a mapped rule's contribution is a lookup and an
// addition, with no re-parse of the stored run and no write:
//
//   byRule.violations['sast___eval_detected'] = 4
//     -> {cwe: 'CWE-95', count: 4, level: 'violation'}
//
// The row the REST API reports carries no field saying where the weakness came
// from - `formatCweFindings` emits cwe/count/level and openapi.yaml documents
// exactly those three. What tells the two apart is the `assigned` sub-count
// applyMappings leaves on the map, which the findings UI reads and the response
// never echoes.
//
// An assignment therefore lights up historical documents immediately, over REST
// as well as in the UI, and removing one is just as immediate. rules.byCwe keeps
// exactly one meaning: what the tool itself published. That is what lets the UI
// show an assignment as a human's claim rather than as tool output.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as cweExtract.js, runStatus.js and findingSummary.js.

const {normalizeCwe, BUCKET_BY_LEVEL} = require('./cweExtract');
const {collectRules, resolveResultSeverity} = require('./runStatus');

const LEVEL_BUCKETS = ['violations', 'warnings', 'notes'];

// The bounds a mapping has to satisfy, declared once. cweMappingSchema.js
// enforces them on the stored document and the set/remove interactors enforce
// them on the way in, BEFORE doing work proportional to the input - schema
// validation only runs at insert, which is far too late to protect a
// single-threaded event loop from a caller-supplied array.
//
// 50 weaknesses on one rule is already generous: the busiest CWE-tagged rules in
// the catalogues this reads (CodeQL's path-injection queries) declare five.
const CWE_MAPPING_MAX_CWES = 50;
const CWE_MAPPING_RULE_ID_MAX = 500;
const CWE_MAPPING_TOOL_MAX = 200;

// The exact escaping testImports/create.js applies before using a rule id as a
// Mongo key. Applied to both sides of the lookup so the findings page (raw ids
// from the parsed run) and the stored counts (escaped ids) reach one entry.
// It is one-way, which is fine here: nothing ever needs to read a rule id back
// out of the index.
function escapeRuleId(ruleId) {
  return String(ruleId).replace(/\./g, '___').replace(/^\$/, '_dollar_');
}

// Drivers report their own name verbatim - "semgrep", "CodeQL", "Bandit" - and a
// mapping entered against one spelling has to match a document that stored
// another.
function normalizeTool(tool) {
  return typeof tool === 'string' ? tool.trim().toLowerCase() : '';
}

// A NUL separator, because it cannot occur in a tool name or a rule id, so no pair of them can collide
// into another pair's key.
function mappingKey(tool, ruleId) {
  return normalizeTool(tool) + '\u0000' + escapeRuleId(ruleId);
}

// Ids are normalised on write too; re-normalising here means an entry written
// before that, or edited straight in the database, still resolves to the spelling
// the rest of TrustSource uses. Anything unparseable is dropped rather than
// carried through as a weakness that matches nothing.
function usableCwes(cwes) {
  const out = [];
  if (!Array.isArray(cwes)) {
    return out;
  }
  cwes.forEach((raw) => {
    const cwe = normalizeCwe(raw);
    if (cwe && out.indexOf(cwe) === -1) {
      out.push(cwe);
    }
  });
  return out;
}

// Mapping documents -> the lookup the read paths use.
//
// A company entry REPLACES the global default for the same (tool, ruleId) rather
// than unioning with it: a company that disagrees with the global classification
// has to be able to say so without the default still applying underneath.
//
// Entries belonging to some other company are ignored outright. The publication
// and the REST query already scope by company; this is the second lock, so a
// sloppy query somewhere cannot leak one customer's classification into
// another's findings.
//
// Object.create(null) on both: the key is built from a tool name and a rule id,
// and both come out of an uploaded document. The NUL separator already stops a
// key from spelling `constructor`, but an index with no prototype cannot be
// confused by one however the key is built later.
function indexMappings(mappings, companyId) {
  const own = Object.create(null);
  const global = Object.create(null);
  if (Array.isArray(mappings)) {
    mappings.forEach((mapping) => {
      if (!mapping || !mapping.tool || !mapping.ruleId) {
        return;
      }
      const cwes = usableCwes(mapping.cwes);
      if (!cwes.length) {
        return;
      }
      const entry = {cwes: cwes, userName: mapping.userName, companyId: mapping.companyId || null};
      const key = mappingKey(mapping.tool, mapping.ruleId);
      if (!mapping.companyId) {
        global[key] = entry;
      } else if (companyId && mapping.companyId === companyId) {
        own[key] = entry;
      }
    });
  }
  for (const key in global) {
    if (Object.prototype.hasOwnProperty.call(global, key) && !own[key]) {
      own[key] = global[key];
    }
  }
  return own;
}

// The whole entry, for a caller that needs to say who claimed the weakness.
function mappedEntryForRule(index, tool, ruleId) {
  if (!index || !ruleId) {
    return null;
  }
  const key = mappingKey(tool, ruleId);
  return Object.prototype.hasOwnProperty.call(index, key) ? index[key] || null : null;
}

// Just the weaknesses. Empty means nobody has classified this rule, which is the
// state the Assign CWE action exists for.
function mappedCwesForRule(index, tool, ruleId) {
  const entry = mappedEntryForRule(index, tool, ruleId);
  return entry ? entry.cwes.slice() : [];
}

function emptyCounts() {
  return {violations: 0, warnings: 0, notes: 0};
}

// Whether any rule on this document carries an assignment at all - cheap enough
// to ask before doing the work.
function hasMappings(index) {
  return !!index && Object.keys(index).length > 0;
}

// Only the three counters, dropped into a fresh object. The stored entry also
// carries `ruleIds` (which rules the tool published this weakness for), and that
// is internal attribution: it must not reach a consumer, and above all not the
// REST response, whose row shape is a published contract.
function countsOnly(counts) {
  const entry = emptyCounts();
  LEVEL_BUCKETS.forEach((bucket) => {
    entry[bucket] = +(counts && counts[bucket]) || 0;
  });
  return entry;
}

// Which rules the TOOL published each weakness for, as the escaped ids
// rules.byRule is keyed by. Built once per call.
//
// A document imported before this attribution existed has no `ruleIds`, so its
// entry yields an empty set and the overlay falls back to adding - the behaviour
// that shipped. That can still double-count on such a document, but the
// alternative (assuming the published weakness came from the mapped rule) would
// silently DROP real findings from a second rule, which is worse. Re-importing
// the scan writes the attribution and settles it.
function publishedRuleKeys(byCwe) {
  const keys = Object.create(null);
  for (const cwe in byCwe) {
    if (!Object.prototype.hasOwnProperty.call(byCwe, cwe)) {
      continue;
    }
    const entry = byCwe[cwe];
    const ruleIds = entry && entry.ruleIds;
    const escaped = new Set();
    if (Array.isArray(ruleIds)) {
      ruleIds.forEach((ruleId) => escaped.add(escapeRuleId(ruleId)));
    }
    keys[cwe] = escaped;
  }
  return keys;
}

// A stored rules.byCwe merged with what the company's mappings add.
//
// A finding is counted ONCE per weakness. When the tool already published `cwe`
// for the very rule a human also assigned `cwe` to - a tool that learned to
// classify a rule after someone had already classified it by hand - the mapping
// adds nothing: those findings are in the stored counts already. Adding them
// again is how a rule that fired twice came to be reported as `count: 4`.
//
// The result carries an `assigned` sub-count beside the totals, so a consumer can
// tell a weakness a human claimed from one the tool published. It accumulates
// only findings attributed to the weakness by a mapping ALONE, which is what
// lets the UI say "every contribution here is a human's claim" by comparing it
// with the totals. The stored map is copied, never mutated: it belongs to the
// caller's document.
function applyMappings(byCwe, byRule, index, tool) {
  const out = {};
  for (const cwe in byCwe) {
    if (Object.prototype.hasOwnProperty.call(byCwe, cwe)) {
      out[cwe] = countsOnly(byCwe[cwe]);
    }
  }
  if (!hasMappings(index) || !byRule) {
    return out;
  }
  const published = publishedRuleKeys(byCwe);
  LEVEL_BUCKETS.forEach((bucket) => {
    const counts = byRule[bucket];
    if (!counts || typeof counts !== 'object') {
      return;
    }
    for (const escapedRuleId in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, escapedRuleId)) {
        continue;
      }
      const findings = +counts[escapedRuleId] || 0;
      if (findings <= 0) {
        continue;
      }
      // A rule a human assigned several weaknesses to counts once under each, the
      // same way cweExtract treats a rule the tool tagged with several.
      mappedCwesForRule(index, tool, escapedRuleId).forEach((cwe) => {
        if (published[cwe] && published[cwe].has(escapedRuleId)) {
          return;
        }
        if (!out[cwe]) {
          out[cwe] = countsOnly(null);
        }
        if (!out[cwe].assigned) {
          out[cwe].assigned = countsOnly(null);
        }
        out[cwe][bucket] += findings;
        out[cwe].assigned[bucket] += findings;
      });
    }
  });
  return out;
}

// The same per-rule finding counts rules.byRule holds, computed from a parsed
// run instead of read from the document.
//
// The findings page has the run in hand and not the stored counts, and a
// document imported before rules.byCwe existed has no stored weakness map at
// all - so recounting here is what lets the overlay behave identically on both
// paths. Keys are escaped exactly as the import escapes them, so one index
// serves both.
//
// The bucket maps are Object.create(null): their keys are rule ids out of the
// uploaded document, and on a plain object `out.violations['constructor']` reads
// back the Object function, so `(that || 0) + 1` would store a string where a
// count belongs.
function collectRunRuleCounts(run) {
  const out = {
    violations: Object.create(null),
    warnings: Object.create(null),
    notes: Object.create(null)
  };
  const results = run && Array.isArray(run.results) ? run.results : [];
  if (!results.length) {
    return out;
  }
  const rules = collectRules(run);
  for (const result of results) {
    const severity = resolveResultSeverity(result, rules);
    const bucket = severity && BUCKET_BY_LEVEL[severity.level];
    if (!bucket) {
      continue;
    }
    const key = escapeRuleId(severity.ruleId);
    out[bucket][key] = (out[bucket][key] || 0) + 1;
  }
  return out;
}

module.exports = {
  CWE_MAPPING_MAX_CWES,
  CWE_MAPPING_RULE_ID_MAX,
  CWE_MAPPING_TOOL_MAX,
  escapeRuleId,
  collectRunRuleCounts,
  normalizeTool,
  indexMappings,
  mappedEntryForRule,
  mappedCwesForRule,
  hasMappings,
  applyMappings
};

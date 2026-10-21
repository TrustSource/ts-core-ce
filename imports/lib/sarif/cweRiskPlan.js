// Auto-created Risks per (module, tool, CWE) from a SARIF import.
//
// Every DECISION this feature makes lives here: which weaknesses become Risks,
// what identifies one, what its occurrence list looks like, and - the part the
// user cared about most - whether anything actually changed since the last
// import. Nothing here reads or writes the database; the server interactor
// (imports/lib/interactors/riskProperties/reconcileFromSarif.js) is the only
// thing that does.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as cweExtract.js, runStatus.js and findingSummary.js.
// The client bundle imports SOURCE_REF_LEVELS / SOURCE_REF_LEVEL_LABEL from here
// for the risk detail view, so nothing server-only may ever be added.
//
// WHY IDENTITY IS ITS OWN FIELD
//
// `origin`, `name` and `threatModelContext.cwes` are all user-editable, so none
// of them can identify an auto-managed Risk: renaming one would make the next
// import mint a second. `autoKey` is written once at creation, stripped from
// every client-reachable modifier (see riskProperties/managedFields.js), and
// carries a unique partial index - so it is the one thing a re-import can match
// on, whatever a human has done to the rest of the document.

const {collectRules, resolveRuleForResult, resolveResultSeverity} = require('./runStatus');
const {BUCKET_BY_LEVEL, extractRuleCwes} = require('./cweExtract');
const {normalizeTool, CWE_MAPPING_TOOL_MAX} = require('./cweMappingOverlay');
const {findingLocations, fileOfLocation} = require('./findingSummary');

const AUTO_KEY_PREFIX = 'sarif-cwe';
const AUTO_KEY_SEPARATOR = '|';

// An uncapped blackbox array built from an uploaded document is a 16MB-document
// hazard and an event-loop hazard, so the occurrence list is bounded - and the
// truncation is disclosed rather than silent (sourceRefsTotal /
// sourceRefsTruncated). One named export, trivial to raise.
const SOURCE_REFS_MAX = 1000;

// A rule id and a file path are uploaded content of unbounded length, and both
// are stored VERBATIM once per occurrence - up to SOURCE_REFS_MAX of them per
// risk, per tool. Uncapped, a 4 MB upload of long uris expands to hundreds of
// megabytes of `sourceRefs` (measured at 198x), so the two attacker-sized fields
// carry their own bound. 256 is far above any real rule id and 1024 above any
// real repository path.
const SOURCE_REF_RULE_ID_MAX = 256;
const SOURCE_REF_URI_MAX = 1024;

// Sort rank AND the only levels that produce an occurrence: violations first,
// then warnings, then notes. Anything BUCKET_BY_LEVEL does not know is dropped,
// exactly as collectRunCwes already drops it.
const SOURCE_REF_LEVELS = ['error', 'warning', 'note'];
// SARIF level -> the word the Tests feature already prints for it. `error` is a
// "violation" here, matching rules.violations and the findings status filter.
const SOURCE_REF_LEVEL_LABEL = {error: 'violation', warning: 'warning', note: 'note'};

// Mirrors RiskSchema.name.max and riskProperties.autoKey.max. Declared here
// because the planner is what has to stay inside them - a generated value that
// overflows fails collection2 deep inside the insert, and the feature then
// silently produces nothing for that tool.
const RISK_NAME_MAX = 200;
const AUTO_KEY_MAX = 300;
// Mirrors RiskPropertiesSchema.autoTool.max. The tool segment is stored on its
// own as `riskProperties.autoTool` as well as inside the key, and escaping can
// triple its length, so a segment can clear the key bound and still overflow
// that field - which fails collection2 INSIDE insertRisk, on every import,
// forever, with only a console.error. cweRiskPlan may not import riskSchema.js
// (it pulls in meteor/aldeed:simple-schema and this module is in the client
// bundle), so the two are pinned value-equal by a source assertion in
// cwe-risk-wiring.source.unit.spec.js.
const AUTO_TOOL_MAX = 200;

// One import may not mint an unbounded number of Risks for one tool: the write
// count is what the REST response waits on (the reconcile runs before
// response.end), and a crafted catalogue could otherwise declare thousands of
// weaknesses. 200 is far above anything a real scan produces.
const CWE_RISKS_MAX_PER_TOOL = 200;
// ...nor an unbounded number of TOOLS. TestImportsCreate makes one bucket per
// SARIF *run*, and a single document may declare any number of runs, so without
// this bound one upload of N runs with N distinct driver names plans
// N x CWE_RISKS_MAX_PER_TOOL risks - measured at 40,000 from a 426 KB body. A
// real scan reports one to three tools.
const CWE_RISK_MAX_TOOLS = 8;
// ...and the two bounds still multiply, so the total is capped outright. This is
// the one that actually binds: it is the number of Mongo round trips (insert +
// logEvent each) a single synchronous REST request can be made to perform.
const CWE_RISKS_MAX_PER_IMPORT = 400;
// The reconcile re-reads the stored Tests documents by id; the id list is
// caller-supplied, so it is bounded before any work proportional to it.
const SARIF_RECONCILE_MAX_TESTS = 200;

const CWE_ID = /^CWE-\d+$/;
// normalizeCwe only ever emits 'CWE-' + a safe integer, so 'CWE-9007199254740991'
// is the longest weakness id that can reach the key builder.
const CWE_ID_MAX = 20;
// Neither a rule id nor a file path can contain a NUL, so no pair of triples can
// collide into another pair's key. (A space can appear in both, which is why the
// obvious separator is the wrong one.)
const TRIPLE_SEPARATOR = '\u0000';

// The tool segment of the identity key.
//
// 1. normalizeTool (reused, not re-declared): trim + lower-case, so a mapping
//    entered against "CodeQL" reaches a document that stored "codeql".
// 2. A run whose driver publishes no name contributes NOTHING - a
//    `sarif-cwe|<mod>||CWE-79` key would collide every unnamed tool into one
//    Risk.
// 3. `%` and `|` are the only two characters that could forge a segment
//    boundary. `%` is escaped first, or `a|b` and `a%7Cb` would produce the same
//    segment. For every real driver name this is the identity function, so the
//    key AC7 quotes holds literally.
function escapeKeySegment(value) {
  return value.replace(/%/g, '%25').replace(/\|/g, '%7C');
}

function toolKeySegment(rawToolName) {
  const normalized = normalizeTool(rawToolName);
  if (!normalized || normalized.length > CWE_MAPPING_TOOL_MAX) {
    return null;
  }
  return escapeKeySegment(normalized);
}

// 'sarif-cwe|<moduleId>|<tool>|<CWE-nnn>'. companyId is deliberately absent -
// moduleId already implies exactly one company - but every selector built from
// this key still carries companyId for defence in depth.
//
// The moduleId goes through the SAME escape as the tool segment. It is the
// identity function for every id Meteor mints (its alphabet contains neither `%`
// nor `|`) and for every id the reconcile would accept, so no stored key
// changes - but leaving one of the two variable segments unescaped is an
// asymmetry a later change could turn into a forgeable boundary.
//
// Returns null rather than a key that could not be stored: escaping can triple a
// segment's length (200 `%` characters become 600), which would overflow the
// schema's max and fail the insert after the work was already done.
function buildAutoKey(moduleId, normalizedTool, cwe) {
  if (typeof moduleId !== 'string' || !moduleId) {
    return null;
  }
  if (typeof normalizedTool !== 'string' || !normalizedTool) {
    return null;
  }
  if (typeof cwe !== 'string' || !CWE_ID.test(cwe)) {
    return null;
  }
  const key = [AUTO_KEY_PREFIX, escapeKeySegment(moduleId), normalizedTool, cwe]
    .join(AUTO_KEY_SEPARATOR);
  return key.length > AUTO_KEY_MAX ? null : key;
}

// The house spelling of the tools that publish CWEs. The normalized tool is
// lower-cased so a mapping entered against "CodeQL" reaches a document that
// stored "codeql" - but the risk NAME is written once and never rewritten, so
// without this map every risk ever minted keeps `codeql` / `sonarqube` /
// `snyk code` as its permanent title. AC13 requires the name to be a
// deterministic function OF the normalized tool, not that the function be the
// identity: the same normalized tool still always yields the same name, and an
// unlisted tool still falls back to its own filtered spelling.
const TOOL_DISPLAY = {
  bandit: 'Bandit',
  codeql: 'CodeQL',
  gitleaks: 'Gitleaks',
  semgrep: 'Semgrep',
  'snyk code': 'Snyk Code',
  sonarqube: 'SonarQube',
  trivy: 'Trivy'
};

// Not "an unnamed tool": a run with no driver name never reaches here (it is
// dropped under dropped.noTool), so the only way to arrive with nothing left is
// a name the filter emptied - and calling "Проверка" and "安全扫描" unnamed is
// both untrue and a collision, since it gives two different tools byte-identical
// risk names.
const UNSUPPORTED_TOOL_LABEL = 'a tool with an unsupported name';

// The character filter is not decoration: a driver name is uploaded content and
// RiskSchema.name carries two anti-XSS regexes rejecting <, >, backtick,
// `javascript:` and `on\w+=`. Without it a hostile tool name would fail
// collection2 validation and the feature would silently produce nothing for
// that tool. `:` is NOT in the allow-list even though it looks harmless in a
// product name - a driver calling itself `javascript:alert(1)` would otherwise
// survive the filter and then be rejected by the second regex, which is the very
// failure the filter exists to prevent.
//
// Exported because the tool name reaches log messages too, and Company Logs is
// exported to CSV with `quotes: false` - so a driver name carrying a comma, a
// newline or a leading `=` would forge a row or a spreadsheet formula. Same
// filter, one place: `,`, CR/LF and `=` are all outside the allow-list.
//
// hasOwnProperty rather than a truthiness check: the normalized tool is uploaded
// content and `constructor` / `toString` are members of every plain object.
function toolLabel(normalizedTool) {
  const tool = String(normalizedTool || '');
  const display = Object.prototype.hasOwnProperty.call(TOOL_DISPLAY, tool) ?
    TOOL_DISPLAY[tool] : tool;
  return display
    .replace(/[^A-Za-z0-9 ._+/@()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || UNSUPPORTED_TOOL_LABEL;
}

// The name is written ONCE, at creation, and never rewritten - it is
// human-editable, so rewriting would clobber a rename, and a count baked into a
// name goes stale on the next scan. Every count the UI shows is rendered live
// from sourceRefs instead.
function buildRiskName(cwe, normalizedTool) {
  return ('[' + cwe + '] Weakness reported by ' + toolLabel(normalizedTool))
    .slice(0, RISK_NAME_MAX);
}

// Distinct file paths a single result points at. findingLocations answers with
// [{}] for a result carrying no `locations` at all (legal SARIF 2.1.0 3.27.12),
// so this is never empty: such a finding is recorded under an empty uri and is
// still counted.
function urisOfResult(result) {
  const seen = [];
  findingLocations(result).forEach(function (location) {
    const uri = fileOfLocation(location);
    if (seen.indexOf(uri) === -1) {
      seen.push(uri);
    }
  });
  return seen;
}

// One run -> {'CWE-79': [entry, ...], ...}, unsorted, one entry per distinct
// (ruleId, uri, level) triple with the number of findings that resolved to it.
//
// `cwesByRuleId` is Object.create(null) and the per-CWE triple index is a Map,
// because rule ids and file paths come straight out of an uploaded document and
// can spell `constructor` / `__proto__` / `toString`. `byCwe` may be a plain
// object: its keys are /^CWE-\d+$/ by construction.
// A field of an occurrence entry, coerced and bounded. `String()` because a
// SARIF `ruleId` or `uri` need not be a string (nothing in the format enforces
// it), and an object reaching the stored blackbox array would both violate the
// repo's standing "no client-shaped objects into Mongo" rule and silently break
// change detection - canonicalSourceRefs collapses every object to
// "[object Object]", so two different imports would compare unchanged.
function cappedField(value, max) {
  const text = value === undefined || value === null ? '' : String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function collectRunSourceRefs(run, normalizedTool) {
  const byCwe = {};
  const results = run && Array.isArray(run.results) ? run.results : [];
  if (!results.length) {
    return byCwe;
  }
  const rules = collectRules(run);
  const cwesByRuleId = Object.create(null);
  const indexByCwe = new Map();
  for (const result of results) {
    const severity = resolveResultSeverity(result, rules);
    // hasOwnProperty AND a string check, not `BUCKET_BY_LEVEL[level]`:
    // BUCKET_BY_LEVEL is a plain object literal, so a crafted level of
    // `constructor` / `toString` / `__proto__` answers with an inherited member,
    // is truthy, and survives a filter whose whole job is to drop it - storing
    // an occurrence with a level outside the three that SOURCE_REF_LEVELS,
    // SOURCE_REF_LEVEL_LABEL and compareSourceRefs all assume. A non-string
    // level (SARIF does not enforce the type) is refused for the same reason.
    if (!severity || typeof severity.level !== 'string' ||
        !Object.prototype.hasOwnProperty.call(BUCKET_BY_LEVEL, severity.level)) {
      continue;
    }
    if (!cwesByRuleId[severity.ruleId]) {
      cwesByRuleId[severity.ruleId] = extractRuleCwes(resolveRuleForResult(result, rules));
    }
    const cwes = cwesByRuleId[severity.ruleId];
    if (!cwes.length) {
      // Never guess a weakness the tool did not publish.
      continue;
    }
    // Capped ONCE, before the triple key is built, so what is aggregated on is
    // exactly what is stored - otherwise two uris differing only past the cap
    // would be two entries holding the same string.
    const ruleId = cappedField(severity.ruleId, SOURCE_REF_RULE_ID_MAX);
    const uris = urisOfResult(result);
    for (const cwe of cwes) {
      if (!indexByCwe.has(cwe)) {
        indexByCwe.set(cwe, new Map());
        byCwe[cwe] = [];
      }
      const triples = indexByCwe.get(cwe);
      for (const rawUri of uris) {
        const uri = cappedField(rawUri, SOURCE_REF_URI_MAX);
        // NUL separators: neither a rule id nor a path can contain one, so no
        // pair of triples can collide into another's key.
        const key = ruleId + TRIPLE_SEPARATOR + uri + TRIPLE_SEPARATOR + severity.level;
        const existing = triples.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          const entry = {tool: normalizedTool, ruleId, uri,
            level: severity.level, count: 1};
          triples.set(key, entry);
          byCwe[cwe].push(entry);
        }
      }
    }
  }
  return byCwe;
}

// Plain `<` / `>`, NOT localeCompare: ICU collation is locale-dependent, so the
// stored order would differ between a dev machine and a container and the same
// document imported twice would compare unequal. The triple is unique after
// aggregation, so this is a total order and sort stability is irrelevant.
function compareSourceRefs(a, b) {
  if (a.ruleId !== b.ruleId) {
    return a.ruleId < b.ruleId ? -1 : 1;
  }
  if (a.uri !== b.uri) {
    return a.uri < b.uri ? -1 : 1;
  }
  return SOURCE_REF_LEVELS.indexOf(a.level) - SOURCE_REF_LEVELS.indexOf(b.level);
}

// The stored shape of one Risk's occurrence list: sorted, capped, and honest
// about the cap.
function finalizeSourceRefs(entries) {
  const sorted = (Array.isArray(entries) ? entries : []).slice().sort(compareSourceRefs);
  const sourceRefsTotal = sorted.length;
  const sourceRefsTruncated = sourceRefsTotal > SOURCE_REFS_MAX;
  return {
    sourceRefs: sourceRefsTruncated ? sorted.slice(0, SOURCE_REFS_MAX) : sorted,
    sourceRefsTotal,
    sourceRefsTruncated
  };
}

function cweNumber(cwe) {
  return parseInt(cwe.slice(4), 10);
}

// Runs of the same normalized tool are unioned across the WHOLE import before
// anything is finalized (AC16); different tools stay in separate buckets and
// never see each other's occurrences (AC17).
function bucketByTool(moduleId, documents, dropped) {
  const byTool = new Map();
  documents.forEach(function (document) {
    const run = document && document.run;
    if (!run || typeof run !== 'object') {
      return;
    }
    const rawTool = (document && document.tool) ||
      (run.tool && run.tool.driver && run.tool.driver.name);
    const normalized = normalizeTool(rawTool);
    if (!normalized) {
      dropped.noTool += 1;
      return;
    }
    const segment = toolKeySegment(rawTool);
    // The longest key this tool could ever produce, checked once here rather
    // than per weakness: either the name is longer than the tool cap, or
    // escaping pushed the assembled key past what the schema can store. Dropping
    // the whole run is the honest outcome - a tool whose key does not fit cannot
    // be reconciled on the next import either.
    //
    // AUTO_TOOL_MAX is the third way to overflow: the segment is ALSO stored on
    // its own as `riskProperties.autoTool`, so a ~250-character segment can pass
    // the key check (short moduleId) and still be rejected by collection2 inside
    // insertRisk - on every import, forever, with only a console.error. It has
    // to be refused here, where the drop is counted.
    const worstCaseKey = AUTO_KEY_PREFIX.length + escapeKeySegment(moduleId).length +
      (segment ? segment.length : 0) + CWE_ID_MAX + 3;
    if (!segment || segment.length > AUTO_TOOL_MAX || worstCaseKey > AUTO_KEY_MAX) {
      dropped.toolTooLong += 1;
      return;
    }
    if (!byTool.has(segment)) {
      byTool.set(segment, {tool: segment, entries: new Map()});
    }
    const bucket = byTool.get(segment);
    const byCwe = collectRunSourceRefs(run, segment);
    Object.keys(byCwe).forEach(function (cwe) {
      if (!bucket.entries.has(cwe)) {
        bucket.entries.set(cwe, []);
      }
      const list = bucket.entries.get(cwe);
      byCwe[cwe].forEach(function (entry) {
        list.push(entry);
      });
    });
  });
  return byTool;
}

// Two runs of the same tool can both report the same triple, so the per-run
// entries have to be merged rather than concatenated - otherwise the same
// (rule, file, level) shows up twice with count 1 each instead of once with 2.
function mergeEntries(entries) {
  const merged = new Map();
  entries.forEach(function (entry) {
    const key = entry.ruleId + TRIPLE_SEPARATOR + entry.uri + TRIPLE_SEPARATOR + entry.level;
    const existing = merged.get(key);
    if (existing) {
      existing.count += entry.count;
    } else {
      merged.set(key, {tool: entry.tool, ruleId: entry.ruleId, uri: entry.uri,
        level: entry.level, count: entry.count});
    }
  });
  return Array.from(merged.values());
}

// A user-facing sentence for what the caps left out of an import, or null when
// nothing was dropped. Shown in the upload dialog and the REST response, and
// logged, so a capped import is never silent.
function describeDropped(dropped) {
  const d = dropped || {};
  const tools = d.overToolCap || 0;
  const weaknesses = (d.overCweCap || 0) + (d.overImportCap || 0);
  if (!tools && !weaknesses) {
    return null;
  }
  const parts = [];
  if (tools) {
    parts.push(`${tools} tool${tools === 1 ? '' : 's'} beyond the first ${CWE_RISK_MAX_TOOLS}`);
  }
  if (weaknesses) {
    parts.push(`${weaknesses} weakness${weaknesses === 1 ? '' : 'es'} beyond the limit of ` +
      `${CWE_RISKS_MAX_PER_TOOL} per tool and ${CWE_RISKS_MAX_PER_IMPORT} per import`);
  }
  return `Risks were not created for ${parts.join(' and ')}.`;
}

// What the writer executes: for every tool in this import, the Risks it should
// end up with and the keys the stale sweep must not touch.
//
//   documents: [{tool: <raw Tests.tool>, run: <parsed SARIF run>}]
function planCweRisks(input) {
  const options = input || {};
  const moduleId = options.moduleId;
  const documents = Array.isArray(options.documents) ? options.documents : [];
  const dropped = {noTool: 0, toolTooLong: 0, overCweCap: 0,
    overToolCap: 0, overImportCap: 0};
  const plan = {tools: [], dropped};
  if (typeof moduleId !== 'string' || !moduleId || !documents.length) {
    return plan;
  }

  const byTool = bucketByTool(moduleId, documents, dropped);
  // Sorted first, so WHICH tools survive the cap is a property of the document
  // rather than of the order its runs happen to appear in - the same
  // determinism argument as the per-tool CWE cap below.
  const tools = Array.from(byTool.keys()).sort();
  if (tools.length > CWE_RISK_MAX_TOOLS) {
    dropped.overToolCap += tools.length - CWE_RISK_MAX_TOOLS;
    tools.length = CWE_RISK_MAX_TOOLS;
  }
  // The global budget. Enforced across tools rather than inside one, because the
  // per-tool cap multiplies by the number of tools and that product is what the
  // REST request waits on before response.end.
  let planned = 0;
  tools.forEach(function (tool) {
    const bucket = byTool.get(tool);
    // Ascending CWE number, so which Risks survive the per-tool cap is
    // deterministic rather than a function of document order.
    const cwes = Array.from(bucket.entries.keys()).sort(function (a, b) {
      return cweNumber(a) - cweNumber(b);
    });
    if (cwes.length > CWE_RISKS_MAX_PER_TOOL) {
      dropped.overCweCap += cwes.length - CWE_RISKS_MAX_PER_TOOL;
      cwes.length = CWE_RISKS_MAX_PER_TOOL;
    }
    const risks = [];
    const keys = [];
    cwes.forEach(function (cwe) {
      const autoKey = buildAutoKey(moduleId, tool, cwe);
      if (!autoKey) {
        return;
      }
      // Pushed BEFORE the budget check: this weakness IS in the document, so its
      // key is protected from the stale sweep whether or not there was room left
      // to write it. Otherwise hitting the cap would EMPTY the evidence of the
      // very risks it declined to refresh - a worse outcome than not refreshing
      // them.
      keys.push(autoKey);
      if (planned >= CWE_RISKS_MAX_PER_IMPORT) {
        dropped.overImportCap += 1;
        return;
      }
      planned += 1;
      const shape = finalizeSourceRefs(mergeEntries(bucket.entries.get(cwe)));
      risks.push({
        cwe,
        autoKey,
        name: buildRiskName(cwe, tool),
        sourceRefs: shape.sourceRefs,
        sourceRefsTotal: shape.sourceRefsTotal,
        sourceRefsTruncated: shape.sourceRefsTruncated
      });
    });
    // Pushed even when it plans no Risk at all. A tool PRESENT in this import
    // that published no weakness this time is exactly the case AC24 is about:
    // the stale sweep has to run for it and empty the occurrence lists of the
    // risks its previous scan created. An empty `keys` makes the sweep's $nin
    // match all of them, which is the intent.
    plan.tools.push({tool, keys, risks});
  });
  return plan;
}

// --- change detection ------------------------------------------------------
//
// AC15 is the sharp requirement: a byte-identical re-import performs NO WRITE AT
// ALL - `edited` untouched, zero logevents - not merely "no duplicate row". So
// the comparison has to be exact and has to survive a round trip through BSON.
//
// The canonical form is an ARRAY OF POSITIONAL TUPLES, not the entry objects, so
// it is immune to the key order Mongo hands a subdocument back in and to any
// extra key a future writer leaves on an entry.
function canonicalSourceRefs(entries) {
  return JSON.stringify((Array.isArray(entries) ? entries : []).map(function (e) {
    return [
      String((e && e.tool) || ''),
      String((e && e.ruleId) || ''),
      String((e && e.uri) || ''),
      String((e && e.level) || ''),
      Number(e && e.count) || 0
    ];
  }));
}

function isSourceRefsUnchanged(stored, next) {
  const prev = function (value) {
    return typeof value === 'number' ? value : null;
  };
  return canonicalSourceRefs(stored.sourceRefs) === canonicalSourceRefs(next.sourceRefs) &&
    (Number(stored.sourceRefsTotal) || 0) === (Number(next.sourceRefsTotal) || 0) &&
    !!stored.sourceRefsTruncated === !!next.sourceRefsTruncated &&
    prev(stored.sourceRefsPrevCount) === prev(next.sourceRefsPrevCount);
}

// The N in the detail view's "0 of N findings still active - ready to close?".
//
// The last branch is what makes a SECOND consecutive empty reconcile a no-op
// instead of resetting "0 of 5" to "0 of 0" and writing a logevent for a change
// nobody made.
function desiredPrevCount(storedTotal, storedPrev, nextLength) {
  if (nextLength > 0) {
    return undefined;
  }
  if (storedTotal > 0) {
    return storedTotal;
  }
  return typeof storedPrev === 'number' ? storedPrev : 0;
}

module.exports = {
  AUTO_KEY_PREFIX,
  AUTO_KEY_SEPARATOR,
  SOURCE_REFS_MAX,
  SOURCE_REF_LEVELS,
  SOURCE_REF_LEVEL_LABEL,
  RISK_NAME_MAX,
  AUTO_KEY_MAX,
  AUTO_TOOL_MAX,
  SOURCE_REF_RULE_ID_MAX,
  SOURCE_REF_URI_MAX,
  CWE_RISKS_MAX_PER_TOOL,
  CWE_RISK_MAX_TOOLS,
  CWE_RISKS_MAX_PER_IMPORT,
  SARIF_RECONCILE_MAX_TESTS,
  // Exported because the license-risk key is built from the same two
  // escaped segments and must not re-declare either the escape or the bound.
  escapeKeySegment,
  toolKeySegment,
  buildAutoKey,
  buildRiskName,
  toolLabel,
  collectRunSourceRefs,
  finalizeSourceRefs,
  planCweRisks,
  describeDropped,
  canonicalSourceRefs,
  desiredPrevCount,
  isSourceRefsUnchanged
};

// Display derivations for SARIF test findings.
//
// The findings page and the tests tables answer the same three questions - how
// severe is this finding, which weaknesses does this document carry, and did a
// human or the tool name them - and they used to answer them with their own
// inline copies. That is how a header reading "5 violations, 2 warnings" ended
// up above seven red rows, and how one badge could be marked as somebody's
// assignment while half its findings came from the tool.
//
// So the rules live here, once, and both surfaces import them. Plain CommonJS
// with no meteor/* imports, so Jest can require it directly - the same
// dual-consumption pattern as imports/lib/sarif/*.
//
// The severity resolution itself stays in imports/lib/sarif/runStatus.js: this
// module is handed the severity that layer resolved and only decides what to
// paint, so the page cannot drift away from the counters again.

const LEVEL_BUCKETS = ['violations', 'warnings', 'notes'];

// The three levels the counting layer has a bucket for (BUCKET_BY_LEVEL in
// cweExtract.js). A level outside them - SARIF's `none`, or anything a tool
// invents - contributes to no counter, so it gets no coloured square either.
const STATUS_CLASS_BY_LEVEL = {error: 'error', warning: 'warning', note: 'note'};

const STATUS_TITLE_BY_LEVEL = {error: 'Violation', warning: 'Warning', note: 'Note'};

// Not an absence of severity: a positive statement that this row is not one of
// the findings the counters counted. Styled grey, next to the red/orange/teal.
const NOT_COUNTED_CLASS = 'not-a-finding';

// The status class for one finding row, given the severity the counting layer
// resolved for it (`resolveResultSeverity`, or null when it could place none).
//
// `kind` is read here as well as there. SARIF's `kind` says whether a result is
// a failure at all and defaults to `fail`; a `pass`, `informational`,
// `notApplicable`, `review` or `open` result contributes 0 to every counter, so
// painting it red was the loudest form of the contradiction this fixes. Asking
// the question on this side too means the row cannot claim a violation the
// counters do not count, whichever layer is patched first.
function findingStatusClass(result, severity) {
  const kind = (result && result.kind) || 'fail';
  if (kind !== 'fail') {
    return NOT_COUNTED_CLASS;
  }
  return (severity && STATUS_CLASS_BY_LEVEL[severity.level]) || NOT_COUNTED_CLASS;
}

// What the square means, spelled out. Always a sentence: a title attribute that
// is sometimes empty is a worse tooltip than none at all.
function findingStatusTitle(result, severity) {
  const status = findingStatusClass(result, severity);
  if (status !== NOT_COUNTED_CLASS) {
    return STATUS_TITLE_BY_LEVEL[status];
  }
  const kind = (result && result.kind) || null;
  return kind && kind !== 'fail' ?
    'Reported as ' + kind + ', not counted as a finding' :
    'No severity reported, not counted as a finding';
}

function bucketTotal(counts) {
  return LEVEL_BUCKETS.reduce(function (sum, bucket) {
    return sum + (+(counts && counts[bucket]) || 0);
  }, 0);
}

// Whether a weakness is a human's claim rather than something the tool said.
//
// The overlay (cweMappingOverlay.applyMappings) accumulates into `assigned` only
// the findings whose attribution came solely from a mapping, and keeps
// assigned[bucket] <= [bucket]. So the badge is an assignment when EVERY
// contribution behind it was human-sourced - not when merely one was, which
// marked a weakness half of whose findings the tool itself reported as
// "assigned here rather than reported by the tool".
function isWhollyAssigned(counts) {
  const assigned = counts && counts.assigned;
  if (!assigned || bucketTotal(counts) === 0) {
    return false;
  }
  return LEVEL_BUCKETS.every(function (bucket) {
    return (+assigned[bucket] || 0) === (+counts[bucket] || 0);
  });
}

function countLabel(count, singular, plural) {
  const value = +count || 0;
  return value + ' ' + (value === 1 ? singular : (plural || singular + 's'));
}

// One badge per weakness, busiest first: what the tool published merged with
// what anyone here assigned, as applyMappings returns it.
function cweBadgeRows(byCwe) {
  const source = byCwe || {};
  return Object.keys(source).map(function (cwe) {
    const counts = source[cwe] || {};
    const count = bucketTotal(counts);
    return {
      cwe: cwe,
      count: count,
      countLabel: countLabel(count, 'finding', 'findings'),
      assigned: isWhollyAssigned(counts)
    };
  }).sort(function (a, b) {
    return b.count - a.count || a.cwe.localeCompare(b.cwe);
  });
}

// The badges for one group of findings, from the weaknesses its results name in
// the order they were collected. The tool's own word wins where both name the
// same weakness: an assignment adds a classification, it never overrides one.
function mergeGroupCwes(entries) {
  const seen = Object.create(null);
  const out = [];
  (entries || []).forEach(function (entry) {
    if (!entry || !entry.cwe) {
      return;
    }
    const assigned = !!entry.assigned;
    if (seen[entry.cwe] === undefined) {
      seen[entry.cwe] = out.length;
      out.push({cwe: entry.cwe, assigned: assigned});
    } else if (!assigned) {
      out[seen[entry.cwe]].assigned = false;
    }
  });
  return out;
}

// Distinct rule ids that fired and that nobody has classified, in the order they
// first fired. `ruleIdOf(result)` returns the id or null for a result no rule
// can be resolved for; `isClassified(result, ruleId)` is asked once per rule, on
// its first result, because reading a rule's weakness tags is the expensive half
// and the answer cannot differ between two findings of the same rule.
//
// The seen-map has a null prototype on purpose: `__proto__`, `constructor` and
// `toString` are all legal SARIF rule ids, and against a bare {} every one of
// them tested as already-seen and was dropped from the count.
function unclassifiedRuleIds(results, ruleIdOf, isClassified) {
  const seen = Object.create(null);
  const out = [];
  (results || []).forEach(function (result) {
    const ruleId = ruleIdOf(result);
    if (!ruleId || seen[ruleId]) {
      return;
    }
    seen[ruleId] = true;
    if (!isClassified(result, ruleId)) {
      out.push(ruleId);
    }
  });
  return out;
}

// Busiest group first. Ties keep the order the groups first appeared, so the
// list does not reshuffle between two equally large rules.
function sortGroups(groups) {
  return groups.sort(function (a, b) {
    return b.entry.list.length - a.entry.list.length || a.order - b.order;
  }).map(function (group) {
    return group.entry;
  });
}

// A null-prototype map for the same reason unclassifiedRuleIds uses one: a rule
// id or a source path of `__proto__` wrote through to Object.prototype instead
// of into the map, and its whole group vanished from the list.
function groupBy(items, keyOf) {
  const groups = Object.create(null);
  const ordered = [];
  items.forEach(function (item) {
    keyOf(item).forEach(function (key) {
      if (!groups[key]) {
        groups[key] = {order: ordered.length, entry: {ruleId: key, list: []}};
        ordered.push(groups[key]);
      }
      groups[key].entry.list.push(item);
    });
  });
  return ordered;
}

function groupResultsByRule(results) {
  return sortGroups(groupBy(results || [], function (result) {
    return [String(result && result.ruleId)];
  }));
}

// By File is grouped by the paths a finding points at, so one result carrying
// two locations belongs to two groups. `locationsOf` is findingSummary's
// findingLocations, which hands back a single placeholder for a result that
// reports no location at all.
function groupResultsByFile(results, locationsOf) {
  const groups = sortGroups(groupBy(results || [], function (result) {
    return locationsOf(result).map(function (location) {
      return (location.physicalLocation && location.physicalLocation.artifactLocation &&
        location.physicalLocation.artifactLocation.uri) || 'unknown';
    });
  }));
  groups.forEach(function (group) {
    group.isFileGroup = true;
  });
  return groups;
}

// An empty CWEs cell in the tests list means one of two different things, and a
// bare "-" said neither. rules.byCwe was added later and was not
// back-filled, so a document imported before it has no weakness map at all -
// while its own details page still derives the weaknesses from the stored run.
// Re-parsing every run to fill a paginated column is not worth it; saying which
// kind of empty this is, is.
function emptyCweCellState(recorded) {
  return recorded ?
    {recorded: true, className: '', title: 'None of this document\'s findings carry a CWE.'} :
    {
      recorded: false,
      className: 'test-cwes-unrecorded',
      title: 'CWEs were not recorded for this document. Open it to see the weaknesses its findings carry.'
    };
}

module.exports = {
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
};

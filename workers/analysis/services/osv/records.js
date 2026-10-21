import CvssCalculator from 'ae-cvss-calculator';

// OSV records -> what the cache stores: one `osvVulns` document per record, and the
// `cves` entry list of one (component key, version) pair. Pure: no network, no database.

const SUMMARY_MAX = 1000;
const DETAILS_MAX = 20000;
const REFERENCES_MAX = 100;
const AFFECTED_MAX = 50;
const IMPACT_ORDER = ['cvss4', 'cvss3', 'cvss2'];
const CALCULATORS = {
  cvss4: CvssCalculator.Cvss4P0,
  cvss3: CvssCalculator.Cvss3P1,
  cvss2: CvssCalculator.Cvss2
};

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function strings(list) {
  return Array.isArray(list) ? list.filter(item => typeof item === 'string' && item) : [];
}

function byString(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

// The impact key a vector belongs to, read from its prefix: the calculator for the wrong
// version scores 0 without complaint, so the vector decides, not OSV's `type`.
function impactKey(vector) {
  if (vector.indexOf('CVSS:4.0/') === 0) {
    return 'cvss4';
  }
  if (vector.indexOf('CVSS:3.') === 0) {
    return 'cvss3';
  }
  return vector.indexOf('CVSS:') === 0 ? null : 'cvss2';
}

// One CVSS vector -> [impactKey, {vectorString, version, baseScore?, impactScore?, exploitScore?}].
// A vector the calculator rejects keeps its vectorString with no score.
export function scoreVector(vector) {
  if (typeof vector !== 'string' || !vector) {
    return null;
  }
  const key = impactKey(vector);
  if (!key) {
    return null;
  }
  const entry = {
    vectorString: vector,
    version: key === 'cvss2' ? '2.0' : vector.slice(5, vector.indexOf('/'))
  };
  try {
    const scores = new CALCULATORS[key](vector).calculateScores();
    if (typeof scores.base === 'number') {
      entry.baseScore = scores.base;
    }
    if (typeof scores.impact === 'number') {
      entry.impactScore = scores.impact;
    }
    if (typeof scores.exploitability === 'number') {
      entry.exploitScore = scores.exploitability;
    }
  } catch {
    // an unparseable vector is stored without a score
  }
  return [key, entry];
}

// OSV `severity` -> {cvss2?, cvss3?, cvss4?}, the first vector of each version.
export function severityImpact(severity) {
  const impact = {};
  for (const entry of Array.isArray(severity) ? severity : []) {
    if (!entry || !/^CVSS_V[234]$/.test(entry.type)) {
      continue;
    }
    const scored = scoreVector(entry.score);
    if (scored && !impact[scored[0]]) {
      impact[scored[0]] = scored[1];
    }
  }
  return impact;
}

// The lake UI renders a reference as a link: only http(s) URLs are kept.
function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function affectedPackages(list) {
  return (Array.isArray(list) ? list : []).slice(0, AFFECTED_MAX).map(entry => {
    const pkg = (entry && entry.package) || {};
    const ranges = Array.isArray(entry && entry.ranges) ? entry.ranges : [];
    return {
      ecosystem: typeof pkg.ecosystem === 'string' ? pkg.ecosystem : '',
      name: typeof pkg.name === 'string' ? pkg.name : '',
      purl: typeof pkg.purl === 'string' ? pkg.purl : '',
      ranges: ranges.map(range => ({
        type: range && range.type,
        events: Array.isArray(range && range.events) ? range.events : []
      }))
    };
  });
}

// One OSV record -> its `osvVulns` document. `listedModified` is `modified` as querybatch
// listed it. The next analysis compares against that, not the record's own `modified`:
// the two differ in precision, so the record's value would never match.
export function toStoredRecord(osv, listedModified, now) {
  const dbSpecific = (osv && osv.database_specific) || {};
  return {
    _id: osv.id,
    aliases: strings(osv.aliases),
    summary: text(osv.summary, SUMMARY_MAX),
    details: text(osv.details, DETAILS_MAX),
    published: osv.published || null,
    modified: osv.modified || null,
    listedModified: typeof listedModified === 'string' ? listedModified : null,
    withdrawn: osv.withdrawn || null,
    cwe_ids: strings(dbSpecific.cwe_ids),
    severityLabel: typeof dbSpecific.severity === 'string' ? dbSpecific.severity : null,
    severity: (Array.isArray(osv.severity) ? osv.severity : [])
      .filter(entry => entry && typeof entry.type === 'string' && typeof entry.score === 'string')
      .map(entry => ({ type: entry.type, score: entry.score })),
    impact: severityImpact(osv.severity),
    references: (Array.isArray(osv.references) ? osv.references : [])
      .filter(ref => ref && isWebUrl(ref.url))
      .slice(0, REFERENCES_MAX)
      .map(ref => ({ type: typeof ref.type === 'string' ? ref.type : null, url: ref.url })),
    affected: affectedPackages(osv.affected),
    fetchedAt: now
  };
}

// The group's impact of the highest CVSS version that carries a score; only when no
// version does, the highest version with a vector. A newer vector the calculator rejected
// must not hide an older one it scored.
function highestImpact(group) {
  const scored = entry => entry && typeof entry.baseScore === 'number';
  for (const test of [scored, entry => !!entry]) {
    for (const key of IMPACT_ORDER) {
      const record = group.find(item => item.impact && test(item.impact[key]));
      if (record) {
        return { [key]: record.impact[key] };
      }
    }
  }
  return {};
}

// The stored records OSV listed for one pair -> that pair's `cves` entry list. Records
// that name each other, directly or through a shared alias, describe one vulnerability:
// they become one entry, named after its CVE when it has one. `vuln_ids` holds exactly
// that one name (the app lists every vuln_ids element as its own finding) and `impact`
// exactly one CVSS version (the worker pairs the last impact key with the best vector).
export function entriesForPair(records) {
  const live = (records || []).filter(record => record && !record.withdrawn);
  const parent = new Map();
  const root = (id) => {
    let current = id;
    while (parent.get(current) !== current) {
      current = parent.get(current);
    }
    return current;
  };
  const add = (id) => {
    if (!parent.has(id)) {
      parent.set(id, id);
    }
  };
  const join = (a, b) => {
    add(a);
    add(b);
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) {
      parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  };
  live.forEach(record => {
    add(record._id);
    strings(record.aliases).forEach(alias => join(record._id, alias));
  });

  const groups = new Map();
  live.forEach(record => {
    const r = root(record._id);
    if (!groups.has(r)) {
      groups.set(r, []);
    }
    groups.get(r).push(record);
  });

  const entries = [];
  groups.forEach(group => {
    group.sort((a, b) => byString(a._id, b._id));
    const ids = new Set();
    group.forEach(record => {
      ids.add(record._id);
      strings(record.aliases).forEach(alias => ids.add(alias));
    });
    const sorted = Array.from(ids).sort(byString);
    const name = sorted.find(id => id.indexOf('CVE-') === 0) || group[0]._id;
    const entry = {
      vuln_ids: [name],
      aliases: sorted.filter(id => id !== name),
      osv_ids: group.map(record => record._id),
      impact: highestImpact(group),
      cisa: null
    };
    const label = group.map(record => record.severityLabel).find(value => typeof value === 'string' && value);
    if (label) {
      entry.severity = label.toLowerCase();
    }
    entries.push(entry);
  });
  return entries.sort((a, b) => byString(a.vuln_ids[0], b.vuln_ids[0]));
}

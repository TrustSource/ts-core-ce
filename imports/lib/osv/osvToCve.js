// Stored OSV records (the `osvVulns` collection, filled by the analysis worker) -> the
// legacy `cve` detail shape the CVE panels, reports, the VEX export, the CSAF editor and
// the Vuln by ID page read. It replaces the old GHSA-mapping module, which mapped GHSA
// records from the TrustSource vulnerability service the same way.
//
// CommonJS with no meteor/* imports so Jest can require it directly.

const IMPACT_KEYS = ['cvss4', 'cvss3', 'cvss2'];

function describeRange(range) {
  const events = (range && range.events) || [];
  const introduced = events.find(event => event && event.introduced !== undefined);
  const fixed = events.find(event => event && event.fixed !== undefined);
  const lastAffected = events.find(event => event && event.last_affected !== undefined);
  const from = introduced ? '>= ' + introduced.introduced : '';
  let to = '';
  if (fixed) {
    to = '< ' + fixed.fixed;
  } else if (lastAffected) {
    to = '<= ' + lastAffected.last_affected;
  }
  return [from, to].filter(Boolean).join(', ');
}

function formatAffected(affected) {
  return (Array.isArray(affected) ? affected : []).map(function (entry) {
    return {
      ecosystem: (entry && entry.ecosystem) || '',
      name: (entry && entry.name) || '',
      ranges: ((entry && entry.ranges) || []).map(describeRange).filter(Boolean)
    };
  });
}

function impactOf(record) {
  const impact = {};
  IMPACT_KEYS.forEach(function (key) {
    const entry = record.impact && record.impact[key];
    if (!entry) {
      return;
    }
    impact[key] = {vectorString: entry.vectorString, baseScore: entry.baseScore, version: entry.version};
    impact[key + '_exploitscore'] = entry.exploitScore !== undefined ? entry.exploitScore : 'n.a.';
    impact[key + '_impactscore'] = entry.impactScore !== undefined ? entry.impactScore : 'n.a.';
  });
  return impact;
}

// The details render a reference as a link: only http(s) URLs are listed, whatever an
// older stored record still carries.
function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function osvToCve(record) {
  const cweIds = Array.isArray(record.cwe_ids) ? record.cwe_ids : [];
  return {
    cve_id: record._id,
    osv_id: record._id,
    aliases: Array.isArray(record.aliases) ? record.aliases.slice() : [],
    published: record.published || null,
    lastmodified: record.modified || null,
    description: record.details || record.summary || '',
    summary: record.summary || '',
    weakness: cweIds[0] || '',
    cwe_ids: cweIds.slice(),
    severityLabel: record.severityLabel || null,
    affected: formatAffected(record.affected),
    impact: impactOf(record),
    references: (record.references || []).filter(function (ref) {
      return ref && isWebUrl(ref.url);
    }).map(function (ref) {
      return {url: ref.url, name: ref.url, refsource: ref.type, tags: []};
    }),
    cisa: null
  };
}

function impactRank(record) {
  const impact = record.impact || {};
  if (impact.cvss4) {
    return 4;
  }
  if (impact.cvss3) {
    return 3;
  }
  return impact.cvss2 ? 2 : 0;
}

function byId(a, b) {
  if (a._id < b._id) {
    return -1;
  }
  return a._id > b._id ? 1 : 0;
}

// Fills what the chosen record lacks from another one, field by field.
function fillMissing(target, source) {
  IMPACT_KEYS.forEach(function (key) {
    if (!target.impact[key] && source.impact[key]) {
      target.impact[key] = source.impact[key];
      target.impact[key + '_exploitscore'] = source.impact[key + '_exploitscore'];
      target.impact[key + '_impactscore'] = source.impact[key + '_impactscore'];
    }
  });
  ['description', 'summary', 'weakness', 'severityLabel', 'published', 'lastmodified'].forEach(function (field) {
    if (!target[field] && source[field]) {
      target[field] = source[field];
    }
  });
  if (!target.cwe_ids.length) {
    target.cwe_ids = source.cwe_ids.slice();
  }
  if (!target.affected.length) {
    target.affected = source.affected;
  }
  if (!target.references.length) {
    target.references = source.references;
  }
}

// Every stored record describing the vulnerability asked for as `name` (by its own id or
// an alias) -> one detail entry called `name`, the id callers match results by.
function mergeCveDetails(name, records) {
  const all = (records || []).filter(Boolean);
  const live = all.filter(function (record) { return !record.withdrawn; });
  const pool = (live.length ? live : all).slice().sort(function (a, b) {
    return (impactRank(b) - impactRank(a)) || byId(a, b);
  });
  if (!pool.length) {
    return null;
  }
  const detail = osvToCve(pool[0]);
  pool.slice(1).forEach(function (record) { fillMissing(detail, osvToCve(record)); });
  const ids = new Set();
  pool.forEach(function (record) {
    ids.add(record._id);
    (record.aliases || []).forEach(function (alias) { ids.add(alias); });
  });
  ids.delete(name);
  detail.cve_id = name;
  detail.aliases = Array.from(ids).sort();
  return detail;
}

module.exports = {osvToCve, mergeCveDetails, formatAffected};

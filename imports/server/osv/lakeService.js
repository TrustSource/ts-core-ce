// What the Vulnerability Lake methods answer, read from the local OSV cache only:
// `cves` (one document per component key and version, written by the analysis worker),
// `osvVulns` (full records) and the bundled CWE catalog. Collections are injected, so Jest
// runs this against fakes; imports/startup/server/ts-vulnerability.js wires in the real ones.
// CommonJS with no meteor/* imports.
const {pairIdsFromPurl} = require('./pairId');
const {mergeCveDetails} = require('../../lib/osv/osvToCve');
const {lookupIds} = require('../../lib/osv/vulnId');

// A details call answers at most DETAIL_IDS_MAX distinct ids, read DETAIL_GROUP asked ids
// per query (callers such as the VEX export send every finding of a big project).
const DETAIL_IDS_MAX = 5000;
const DETAIL_GROUP = 500;
const DETAIL_RECORDS_MAX = 2000;
const SEARCH_MIN = 2;
const SEARCH_MAX = 100;
const SEARCH_DOCS_MAX = 500;
const SEARCH_ROWS_MAX = 200;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A stored OSV record's own id plus its aliases: the spellings it can be found by.
function recordNames(record) {
  return [record._id].concat(record.aliases || []);
}

function recordMatchesAny(record, ids) {
  return recordNames(record).some(function (name) { return ids.indexOf(name) > -1; });
}

function idAnsweredBy(hits, id) {
  return hits.some(function (record) { return recordNames(record).indexOf(id) > -1; });
}

function entryScore(entry) {
  const impact = (entry && entry.impact) || {};
  const best = impact.cvss4 || impact.cvss3 || impact.cvss2;
  return best && typeof best.baseScore === 'number' ? best.baseScore : null;
}

// Cached documents -> one search row per (component key, version).
function searchRows(docs) {
  const rows = [];
  (docs || []).forEach(function (doc) {
    ((doc && doc.versions) || []).forEach(function (version) {
      const vulns = (version.cves || version.vulns || []).map(function (entry) {
        return {
          id: (entry.vuln_ids && entry.vuln_ids[0]) || entry.cve_id,
          score: entryScore(entry),
          severity: entry.severity || null
        };
      }).filter(function (vuln) { return !!vuln.id; });
      const scores = vulns.map(function (vuln) { return vuln.score; }).filter(function (s) { return s !== null; });
      rows.push({
        _id: doc._id + ':' + version.version,
        key: doc.key,
        version: version.version,
        checkedAt: version.checkedAt || null,
        vulns: vulns,
        score: scores.length ? Math.max.apply(null, scores) : null
      });
    });
  });
  return rows;
}

function createLakeService({Cves, OsvVulns, lookupCwe}) {
  // One group of asked ids -> their details, in the asked order. `candidates` maps each
  // asked id to the spellings it is looked up by.
  async function detailsOfGroup(candidates) {
    const all = new Set();
    candidates.forEach(function (ids) {
      ids.forEach(function (candidate) { all.add(candidate); });
    });
    const list = Array.from(all);
    const records = await OsvVulns.find({$or: [{_id: {$in: list}}, {aliases: {$in: list}}]},
      {fields: {severity: 0}, limit: DETAIL_RECORDS_MAX}).fetchAsync();
    const cves = [];
    candidates.forEach(function (ids) {
      const hits = records.filter(function (record) { return recordMatchesAny(record, ids); });
      if (!hits.length) {
        return;
      }
      // Answer under the spelling that actually matched, the one callers asked by when exact.
      const name = ids.find(function (id) { return idAnsweredBy(hits, id); });
      const detail = mergeCveDetails(name, hits);
      if (detail) {
        cves.push(detail);
      }
    });
    return cves;
  }

  // {cves: [...]} -> the details of each id this install has cached, named as asked, in
  // the asked order. Repeated ids are answered once; the first DETAIL_IDS_MAX distinct
  // usable ids are looked up, DETAIL_GROUP per query.
  async function cveDetails(requested) {
    const candidates = new Map();
    (Array.isArray(requested) ? requested : []).forEach(function (id) {
      if (typeof id !== 'string' || !id || candidates.has(id) || candidates.size >= DETAIL_IDS_MAX) {
        return;
      }
      const ids = lookupIds(id);
      if (ids.length) {
        candidates.set(id, ids);
      }
    });
    const entries = Array.from(candidates.entries());
    const cves = [];
    for (let start = 0; start < entries.length; start += DETAIL_GROUP) {
      const group = new Map(entries.slice(start, start + DETAIL_GROUP));
      const found = await detailsOfGroup(group);
      found.forEach(function (detail) { cves.push(detail); });
    }
    return {statusCode: 200, data: {cves: cves, matches: cves.length}};
  }

  // A versioned purl (the component index page) -> the ids cached for that version, read
  // from the pair stored under the purl's key as written or lower-cased.
  async function findByPurl(purl) {
    const docIds = pairIdsFromPurl(purl);
    if (!docIds.length) {
      return {statusCode: 200, data: {vulns: []}};
    }
    const doc = await Cves.findOneAsync({_id: {$in: docIds}});
    const version = doc && doc.versions && doc.versions[0];
    const ids = ((version && version.cves) || [])
      .map(function (entry) { return entry.vuln_ids && entry.vuln_ids[0]; })
      .filter(Boolean);
    return {statusCode: 200, data: {vulns: ids.length ? [{vulns: ids}] : []}};
  }

  function cweDetails(value) {
    return lookupCwe(value);
  }

  // Component search: cached versions whose key contains the text.
  async function search(query) {
    const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (text.length < SEARCH_MIN || text.length > SEARCH_MAX) {
      return {statusCode: 200, data: {matches: 0, list: []}};
    }
    const docs = await Cves.find({key: {$regex: escapeRegex(text)}},
      {fields: {key: 1, versions: 1}, sort: {key: 1}, limit: SEARCH_DOCS_MAX}).fetchAsync();
    const rows = searchRows(docs).slice(0, SEARCH_ROWS_MAX);
    return {statusCode: 200, data: {matches: rows.length, list: rows}};
  }

  return {cveDetails, findByPurl, cweDetails, search};
}

module.exports = {createLakeService, searchRows, escapeRegex};

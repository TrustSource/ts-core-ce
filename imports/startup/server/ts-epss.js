// ts-epss - EPSS (Exploit Prediction Scoring System) score lookup for the
// vulnerability-report CVSS-vs-EPSS scatter plot. One batched lookup per
// report generation, keyed by CVE id.
//
// Scores come straight from FIRST, who publish EPSS. There is no service in
// front of it: the endpoint is public, takes no credential, and is the same one
// any other consumer would call, so a self-hosted installation needs nothing
// provisioned to get scores. The base URL is a constant rather than a setting -
// the same shape as OSV_API_URL in workers/analysis/services/osv/client.js -
// because a configurable URL here would only be a way to point the lookup
// somewhere it should not go.
//
// Scores are cached in the `epssScores` collection, the same shape as the OSV
// cache the analysis worker keeps: one document per id, and only the ids the
// cache does not already know are asked for. A report that runs twice inside the
// freshness window makes no outbound request at all.
//
// Nothing in this module throws. A report that cannot reach FIRST is a report
// whose findings all plot at the floor, not a report that fails, and a cache
// that cannot be read or written only costs the saving it would have made.
//
// Written as CommonJS (require/module.exports) with relative requires for its
// own project dependencies - not the `import {..} from '/imports/lib/httpFetch'`
// ES-module style used by ts-vulnerability.js - because this module is meant to
// be exercised directly by a plain Jest `require()`
// (test_api/specs/ts-epss.unit.spec.js) and this repo's Jest config has no
// babel transform for ES import/export syntax. Same discipline as
// imports/lib/security/ssrfGuard.js. httpFetch.js
// already round-trips through exactly this CommonJS/ESM interop
// (`module.exports` there, `import {httpCall}` in every ES-module caller
// including ts-vulnerability.js), so this is a proven pattern in this
// codebase, not a new one.
const {httpCall} = require('../../lib/httpFetch');
const {Config} = require('../../server/config');
const EpssScores = require('../../lib/collections/epssScores').default ||
  require('../../lib/collections/epssScores');

const EPSS_API_URL = 'https://api.first.org/data/v1/epss';

// Only a well-formed CVE id can have an EPSS record, so anything else - a
// GHSA-only finding, a vendor id, a malformed string - is dropped before the
// request is built rather than asked about and not found.
const CVE_ID_RE = /^CVE-\d{4}-\d{4,}$/;

// The cap is on the LENGTH of the `cve` parameter, not on how many ids it names,
// so requests are packed by characters: CVE ids are not all the same width and a
// fixed count would be needlessly small for short ids and one day too large for
// long ones. Measured against the live API: a 1987-character value is served in
// full, 2001 comes back as `total: 0` - a 200, no error, no rows. 1900 leaves
// room for that boundary to move a little.
const EPSS_MAX_CVE_PARAM_CHARS = 1900;

// Separately, an answer is paged at 100 rows unless `limit` says otherwise, so a
// packed request that did not ask for more would lose everything past the
// hundredth id. `limit` is always set to the chunk size.
const EPSS_PAGE_SAFETY_MAX = 50;

// How long a cached score is served before it is fetched again. FIRST
// recalculates daily, so a day-old score is the same score; expiring on the
// fetch time rather than on the published date spreads refetches through the day
// instead of making the first report after midnight re-ask about everything.
const EPSS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// A report can carry hundreds of findings, which is as many requests as chunks.
// Without a bound, one unanswered connection holds the whole report open.
const EPSS_TIMEOUT_MS = 10 * 1000;

// The `<0.1%` floor from the feature's acceptance criteria - used for any
// finding with no EPSS record, a non-CVE key, or when the request carrying its
// CVE failed. Never 0: a floored score must still read as "an unknown, not a
// measured zero" on the chart's logarithmic axis.
const EPSS_FLOOR = 0.001;

function dedupeValidCveIds(cveIds) {
  const seen = new Set();
  const result = [];
  (cveIds || []).forEach((id) => {
    if (typeof id === 'string' && CVE_ID_RE.test(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  });
  return result;
}

// Pack ids into requests whose joined `cve` value stays within `maxChars`.
// Order is preserved and nothing is dropped: an id longer than the cap on its
// own is emitted alone rather than silently lost, because a request that is
// refused is visible and one that never happened is not.
function chunkByParamLength(ids, maxChars) {
  const chunks = [];
  let current = [];
  let length = 0;
  (ids || []).forEach((id) => {
    const added = current.length ? id.length + 1 : id.length;
    if (current.length && length + added > maxChars) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(id);
    length += current.length > 1 ? id.length + 1 : id.length;
  });
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

// Every score FIRST holds for one chunk, following `offset` until the answer is
// complete. `limit` is set to the chunk size so a complete answer normally
// arrives in one page; the loop is what keeps a capped or unexpectedly paged
// answer from losing its remainder. Bounded two ways - an empty page and a page
// count - so a `total` the server never delivers cannot spin here.
async function fetchChunk(chunk) {
  const entries = [];
  let offset = 0;
  for (let page = 0; page < EPSS_PAGE_SAFETY_MAX; page += 1) {
    const request = await httpCall('GET', EPSS_API_URL, {
      headers: {Accept: 'application/json'},
      params: {cve: chunk.join(','), limit: chunk.length, offset: offset},
      timeoutMs: EPSS_TIMEOUT_MS
    });
    const body = (request && request.data) || {};
    const rows = Array.isArray(body.data) ? body.data : [];
    entries.push(...rows);
    offset += rows.length;
    const total = Number(body.total);
    if (!rows.length || !Number.isFinite(total) || offset >= total) {
      break;
    }
  }
  return entries;
}

// Read the cached scores for `cveIds`, dropping anything past the freshness
// window. Returns a Map of id -> score, where a `null` score is a remembered
// "FIRST has none" and still counts as known. A cache that cannot be read is
// simply empty: the lookup then behaves exactly as it did before there was one.
async function readCache(cveIds, now) {
  const known = new Map();
  try {
    const rows = await EpssScores.find(
      {_id: {$in: cveIds}},
      {fields: {epss: 1, fetchedAt: 1}}
    ).fetchAsync();
    rows.forEach((row) => {
      const fetchedAt = row && row.fetchedAt && new Date(row.fetchedAt).getTime();
      if (Number.isFinite(fetchedAt) && now - fetchedAt < EPSS_CACHE_MAX_AGE_MS) {
        known.set(row._id, typeof row.epss === 'number' ? row.epss : null);
      }
    });
  } catch (error) {
    console.info('=> tsEpssScores: cache read failed, asking upstream instead: ', error);
  }
  return known;
}

// Write back everything the requests settled, scores and absences alike. Only
// ids whose request actually answered are written: a chunk that failed is left
// unknown so a network blip is not remembered as "FIRST has no score".
async function writeCache(resolved, now) {
  if (!resolved.size) {
    return;
  }
  const operations = [];
  resolved.forEach((entry, cve) => {
    operations.push({updateOne: {
      filter: {_id: cve},
      update: {$set: {
        epss: entry.epss,
        percentile: entry.percentile,
        date: entry.date,
        fetchedAt: now
      }},
      upsert: true
    }});
  });
  try {
    await EpssScores.rawCollection().bulkWrite(operations, {ordered: false});
  } catch (error) {
    console.info('=> tsEpssScores: cache write failed, scores still returned: ', error);
  }
}

// Batched EPSS lookup: dedupes + filters `cveIds` to well-formed CVE ids, serves
// what the cache already knows, and asks FIRST only about the rest - packed into
// requests that respect the `cve` parameter cap. Returns a plain
// `{[cveId]: scoreFraction}` map carrying only real scores, so an id FIRST has
// none for is absent and floors through resolveEpss.
//
// FIRST returns `epss` and `percentile` as decimal STRINGS, so each is parsed
// and only a finite number is kept.
//
// Never throws. A failed chunk loses only its own scores, and an empty or
// all-invalid input makes no call at all, so a caller always has a safe default
// to fall back to via resolveEpss.
async function tsEpssScores(cveIds) {
  const epssMap = {};
  // Opt-out for an installation with no route to FIRST: without it every report
  // would spend its whole timeout budget on requests that cannot succeed.
  if (Config.TS_EPSS_ENABLED === false) {
    return epssMap;
  }

  const validCveIds = dedupeValidCveIds(cveIds);
  if (!validCveIds.length) {
    return epssMap;
  }

  const now = Date.now();
  const known = await readCache(validCveIds, now);
  known.forEach((score, cve) => {
    if (typeof score === 'number') {
      epssMap[cve] = score;
    }
  });

  const missing = validCveIds.filter((id) => !known.has(id));
  if (!missing.length) {
    return epssMap;
  }

  if (Config.DEBUG_MODE_ENABLED) {
    console.log(`=> ts-epss: ${validCveIds.length} CVE(s), ${missing.length} not cached, from ${EPSS_API_URL}`);
  }

  const resolved = new Map();
  for (const chunk of chunkByParamLength(missing, EPSS_MAX_CVE_PARAM_CHARS)) {
    try {
      const entries = await fetchChunk(chunk);
      const answered = new Set();
      entries.forEach((entry) => {
        const score = entry && Number(entry.epss);
        if (entry && typeof entry.cve === 'string' && Number.isFinite(score)) {
          epssMap[entry.cve] = score;
          answered.add(entry.cve);
          resolved.set(entry.cve, {
            epss: score,
            percentile: Number(entry.percentile),
            date: typeof entry.date === 'string' ? entry.date : ''
          });
        }
      });
      // Remember the absences too. The chunk answered, so an id it did not name
      // is one FIRST has no score for, not one we failed to ask about.
      chunk.forEach((cve) => {
        if (!answered.has(cve)) {
          resolved.set(cve, {epss: null, percentile: null, date: ''});
        }
      });
    } catch (error) {
      console.info('=> tsEpssScores: ', error);
    }
  }

  await writeCache(resolved, new Date(now));
  return epssMap;
}

// Resolve a single vulnerability's EPSS entry for the scatter chart. Pure,
// never throws. A finite, strictly-positive score in `epssMap` is passed
// through as-is (`floored: false`) - including a genuinely tiny real score -
// anything else (missing key, non-CVE key never sent upstream, NaN/non-finite,
// or a non-positive value) floors to EPSS_FLOOR with `floored: true`, so the
// chart never plots/labels a real "0%"/unknown as if it were a measured score.
function resolveEpss(cveId, epssMap) {
  const value = (epssMap && cveId) ? epssMap[cveId] : undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return {score: value, floored: false};
  }
  return {score: EPSS_FLOOR, floored: true};
}

module.exports = {
  tsEpssScores, resolveEpss, chunkByParamLength,
  EPSS_API_URL, EPSS_MAX_CVE_PARAM_CHARS
};

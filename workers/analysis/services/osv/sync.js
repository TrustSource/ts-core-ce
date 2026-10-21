import { buildQueries } from './queries.js';
import { queryBatch, fetchRecords, OSV_API_URL } from './client.js';
import { toStoredRecord, entriesForPair } from './records.js';

export const FETCH_MAX = 2000;
export const TIME_BUDGET_MS = 120000;
const READ_CHUNK = 1000;
const MATCH_FIELDS = { aliases: 1, withdrawn: 1, impact: 1, severityLabel: 1, listedModified: 1 };

async function readRecords(db, ids) {
  const found = new Map();
  for (let start = 0; start < ids.length; start += READ_CHUNK) {
    const docs = await db.collection('osvVulns')
      .find({ _id: { $in: ids.slice(start, start + READ_CHUNK) } }, { projection: MATCH_FIELDS })
      .toArray();
    docs.forEach(doc => found.set(doc._id, doc));
  }
  return found;
}

function isCurrent(stored, listedModified) {
  return !!stored && stored.listedModified === listedModified;
}

// Refreshes the `cves` cache from OSV for every (component key, version) the analysed
// module uses. Runs once per analysis, right before vulnerabilityAnalysis reads `cves`.
//
// Never throws: OSV or database trouble is logged and the analysis goes on with the cache
// as it is. A pair is rewritten only when its answer arrived and every record it names is
// stored in the version OSV just listed, so a network blip, the fetch cap or the time
// budget never wipes findings the cache already had.
export async function osvSync(db, {
  components, purls, skip, settings, now = new Date(), fetchMax = FETCH_MAX, budgetMs = TIME_BUDGET_MS
}) {
  const stats = { queries: 0, fetched: 0, written: 0 };
  if (!settings || settings.TS_OSV_ENABLED !== true) {
    return stats;
  }
  try {
    const baseUrl = settings.OSV_API_URL || OSV_API_URL;
    const deadline = Date.now() + budgetMs;
    const queries = buildQueries(components, purls, skip);
    stats.queries = queries.length;
    if (!queries.length) {
      return stats;
    }

    const answers = await queryBatch(queries, { baseUrl, deadline });
    const listed = new Map();
    answers.forEach(answer => (answer || []).forEach(vuln => {
      if (!listed.has(vuln.id)) {
        listed.set(vuln.id, vuln.modified);
      }
    }));

    const stored = await readRecords(db, Array.from(listed.keys()));
    const wanted = Array.from(listed.keys()).filter(id => !isCurrent(stored.get(id), listed.get(id)));
    if (wanted.length > fetchMax) {
      console.log('=> osvSync: ' + (wanted.length - fetchMax) + ' records left for the next analysis');
    }
    const fetched = await fetchRecords(wanted.slice(0, fetchMax), { baseUrl, deadline });
    stats.fetched = fetched.size;
    if (fetched.size) {
      const docs = Array.from(fetched.values()).map(osv => toStoredRecord(osv, listed.get(osv.id), now));
      await db.collection('osvVulns').bulkWrite(docs.map(doc => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true }
      })), { ordered: false });
      docs.forEach(doc => stored.set(doc._id, doc));
    }

    const writes = [];
    queries.forEach((query, index) => {
      const vulns = answers[index];
      if (!vulns) {
        return;
      }
      const records = vulns.map(vuln => stored.get(vuln.id));
      if (vulns.some((vuln, i) => !isCurrent(records[i], vuln.modified))) {
        return;
      }
      writes.push({
        replaceOne: {
          filter: { _id: query.id },
          replacement: {
            _id: query.id,
            key: query.key,
            source: 'osv',
            // confidence 1, the highest certainty: OSV matched this exact package and version.
            versions: [{ version: query.version, checkedAt: now, confidence: 1, cves: entriesForPair(records) }]
          },
          upsert: true
        }
      });
    });
    if (writes.length) {
      await db.collection('cves').bulkWrite(writes, { ordered: false });
    }
    stats.written = writes.length;
  } catch (error) {
    console.log('=> osvSync: ' + ((error && error.message) || error));
  }
  return stats;
}

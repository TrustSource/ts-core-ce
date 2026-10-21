import axios from 'axios';

// The only remote party of the vulnerability cache: api.osv.dev. The base URL is a
// constant and never user-supplied; tests hand a local server in through `baseUrl`.

export const OSV_API_URL = 'https://api.osv.dev/v1/';
export const BATCH_SIZE = 1000;
const BATCH_TIMEOUT_MS = 30000;
const RECORD_TIMEOUT_MS = 15000;
const PAGE_ROUNDS_MAX = 10;
const RESPONSE_BYTES_MAX = 32 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

// An id that is safe to put into the vulns/{id} path segment.
export function isOsvId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

function timeoutFor(deadline, ceiling) {
  return Math.max(1, Math.min(ceiling, deadline - Date.now()));
}

// OSV refused this request's content (a query it cannot parse, say): the other chunks
// are still worth asking. Throttling (429) and a request timeout (408) are not about the
// content, so they stop the batch like a network error or a 5xx does.
function rejectedChunk(error) {
  const status = error && error.response && error.response.status;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function reason(error) {
  if (error && error.response) {
    return 'HTTP ' + error.response.status;
  }
  return (error && (error.code || error.message)) || String(error);
}

async function queryChunk(chunk, baseUrl, deadline) {
  const answers = chunk.map(() => []);
  let pending = chunk.map((query, index) => ({ index, body: { package: query.package, version: query.version } }));
  for (let round = 0; pending.length && round < PAGE_ROUNDS_MAX; round++) {
    const response = await axios.post(baseUrl + 'querybatch', { queries: pending.map(item => item.body) }, {
      timeout: timeoutFor(deadline, BATCH_TIMEOUT_MS),
      maxContentLength: RESPONSE_BYTES_MAX
    });
    const results = response && response.data && response.data.results;
    if (!Array.isArray(results) || results.length !== pending.length) {
      throw new Error('malformed querybatch answer');
    }
    const next = [];
    results.forEach((result, position) => {
      const item = pending[position];
      ((result && result.vulns) || []).forEach(vuln => {
        if (vuln && isOsvId(vuln.id)) {
          answers[item.index].push({ id: vuln.id, modified: typeof vuln.modified === 'string' ? vuln.modified : null });
        }
      });
      if (result && typeof result.next_page_token === 'string' && result.next_page_token) {
        next.push({ index: item.index, body: Object.assign({}, item.body, { page_token: result.next_page_token }) });
      }
    });
    pending = next;
  }
  // A query still paging after PAGE_ROUNDS_MAX has an incomplete answer: report none.
  pending.forEach(item => { answers[item.index] = null; });
  return answers;
}

// Which vulnerabilities affect each query. One answer per query, in order: an array of
// {id, modified}, or null when that query's answer did not arrive. Requests go out one at
// a time. A chunk OSV rejects (HTTP 4xx) answers null and the next chunk is still sent;
// any other failure stops the batch and the queries after it answer null.
export async function queryBatch(queries, { baseUrl = OSV_API_URL, deadline }) {
  const answers = queries.map(() => null);
  for (let start = 0; start < queries.length; start += BATCH_SIZE) {
    if (Date.now() >= deadline) {
      console.log('=> osvSync: time budget spent before querybatch finished');
      break;
    }
    try {
      const chunkAnswers = await queryChunk(queries.slice(start, start + BATCH_SIZE), baseUrl, deadline);
      chunkAnswers.forEach((chunkAnswer, offset) => { answers[start + offset] = chunkAnswer; });
    } catch (error) {
      if (rejectedChunk(error)) {
        console.log('=> osvSync: querybatch rejected a chunk: ' + reason(error));
        continue;
      }
      console.log('=> osvSync: querybatch failed: ' + reason(error));
      break;
    }
  }
  return answers;
}

// The full records of `ids`, fetched `concurrency` at a time until the deadline. Answers
// a Map id -> record; an id that failed or ran out of time is simply absent.
export async function fetchRecords(ids, { baseUrl = OSV_API_URL, deadline, concurrency = 4 }) {
  const records = new Map();
  const list = ids.filter(isOsvId);
  let next = 0;
  let failures = 0;
  async function worker() {
    while (next < list.length && Date.now() < deadline) {
      const id = list[next++];
      try {
        const response = await axios.get(baseUrl + 'vulns/' + encodeURIComponent(id), {
          timeout: timeoutFor(deadline, RECORD_TIMEOUT_MS),
          maxContentLength: RESPONSE_BYTES_MAX
        });
        if (response && response.data && response.data.id === id) {
          records.set(id, response.data);
        } else {
          failures++;
        }
      } catch {
        failures++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  if (failures) {
    console.log('=> osvSync: ' + failures + ' record fetches failed');
  }
  return records;
}

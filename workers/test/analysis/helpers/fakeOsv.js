import http from 'node:http';

// A local stand-in for api.osv.dev. Answers querybatch from `state.lists` and
// vulns/{id} from `state.records`, records every request, and tracks how many were in
// flight at once. `state.reply(entry)` may return {status, json} to override an answer.

export function packageLabel(query) {
  const pkg = (query && query.package) || {};
  return (pkg.purl || (pkg.ecosystem + '/' + pkg.name)) + '@' + query.version;
}

function answer(state, entry) {
  if (entry.url === '/querybatch') {
    if (state.failQuerybatch) {
      return { status: 500, json: { message: 'boom' } };
    }
    return {
      status: 200,
      json: {
        results: entry.body.queries.map(query => {
          const vulns = state.lists.get(packageLabel(query)) || [];
          return vulns.length ? { vulns } : {};
        })
      }
    };
  }
  if (entry.method === 'GET' && entry.url.indexOf('/vulns/') === 0) {
    const id = decodeURIComponent(entry.url.slice('/vulns/'.length));
    const record = state.records.get(id);
    return record ? { status: 200, json: record } : { status: 404, json: { code: 5, message: 'Bug not found.' } };
  }
  return { status: 404, json: {} };
}

export async function startFakeOsv() {
  const state = {
    lists: new Map(),
    records: new Map(),
    requests: [],
    inflight: 0,
    maxInflight: 0,
    failQuerybatch: false,
    delayMs: 2,
    reply: null
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      state.inflight++;
      state.maxInflight = Math.max(state.maxInflight, state.inflight);
      const entry = { method: request.method, url: request.url, body: body ? JSON.parse(body) : null };
      state.requests.push(entry);
      setTimeout(() => {
        const { status, json } = (state.reply && state.reply(entry)) || answer(state, entry);
        state.inflight--;
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(json));
      }, state.delayMs);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => server.close(resolve)),
    querybatchCalls: () => state.requests.filter(entry => entry.url === '/querybatch'),
    recordCalls: () => state.requests.filter(entry => entry.url.indexOf('/vulns/') === 0)
  };
}

// A minimal OSV record, shaped like the real ones (fields trimmed).
export function osvRecord(id, { aliases = [], modified = '2026-09-10T03:49:04.067984836Z', vector = null,
  label = null, cwe = [], withdrawn = null } = {}) {
  const record = {
    id,
    modified,
    published: '2021-05-06T16:05:51Z',
    aliases,
    summary: 'Summary of ' + id,
    details: 'Details of ' + id,
    affected: [{
      package: { ecosystem: 'npm', name: 'lodash', purl: 'pkg:npm/lodash' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }]
    }],
    references: [{ type: 'ADVISORY', url: 'https://example.test/' + id }],
    database_specific: { cwe_ids: cwe }
  };
  if (vector) {
    record.severity = [{ type: vector.indexOf('CVSS:4.0/') === 0 ? 'CVSS_V4' : 'CVSS_V3', score: vector }];
  }
  if (label) {
    record.database_specific.severity = label;
  }
  if (withdrawn) {
    record.withdrawn = withdrawn;
  }
  return record;
}

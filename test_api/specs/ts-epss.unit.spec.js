/* eslint-disable no-undef */
// Unit tests for imports/startup/server/ts-epss.js - the EPSS (Exploit
// Prediction Scoring System) score lookup backing the vulnerability
// report CVSS-vs-EPSS scatter plot.
//
// Scores now come straight from FIRST (https://api.first.org/data/v1/epss)
// rather than from a hosted service in front of it. That changes the whole
// transport: a GET with the ids in a `cve` query parameter instead of a POST
// with a JSON body, batches of 100 instead of 1000, results under `data`
// instead of `results`, and no API key - it is a public endpoint.
//
// ts-epss.js is intentionally dependency-free CommonJS (see its own header
// comment) so it can be required directly here with httpCall/Config mocked -
// no Meteor, no running app.
//
// What matters and is asserted below: a report never fails because EPSS did.
// Every outbound request is bounded by a timeout, a chunk that fails loses only
// its own scores, and anything unresolved floors rather than plotting as zero.

jest.mock('../../imports/server/config', () => ({
  Config: {
    TS_EPSS_ENABLED: true,
    DEBUG_MODE_ENABLED: false
  }
}));

jest.mock('../../imports/lib/httpFetch', () => ({
  httpCall: jest.fn()
}));

// The cache collection is mocked rather than injected so the module under test
// keeps the plain `require` shape the rest of this file relies on. Mongo is
// never loaded: jest.mock intercepts the module before meteor/mongo would be.
const mockCacheRows = [];
const mockBulkWrite = jest.fn();
jest.mock('../../imports/lib/collections/epssScores', () => ({
  find: jest.fn((selector) => ({
    fetchAsync: async () => {
      const wanted = new Set(selector._id.$in);
      return mockCacheRows.filter((row) => wanted.has(row._id));
    }
  })),
  rawCollection: () => ({bulkWrite: mockBulkWrite})
}));

const {Config} = require('../../imports/server/config');
const {httpCall} = require('../../imports/lib/httpFetch');
const {
  tsEpssScores, resolveEpss, EPSS_API_URL, EPSS_MAX_CVE_PARAM_CHARS, chunkByParamLength
} = require('../../imports/startup/server/ts-epss');

const HOUR_MS = 60 * 60 * 1000;

function cache(id, epss, ageHours) {
  mockCacheRows.push({_id: id, epss, fetchedAt: new Date(Date.now() - ageHours * HOUR_MS)});
}

// Every id written back to the cache by the last call, as {id: epss}.
function written() {
  const ops = mockBulkWrite.mock.calls.flatMap((call) => call[0]);
  return Object.fromEntries(ops.map((op) => [
    op.updateOne.filter._id, op.updateOne.update.$set.epss
  ]));
}

// The ids a call actually carried, read back off the mock.
function sentCves(callIndex) {
  const options = httpCall.mock.calls[callIndex][2];
  return String(options.params.cve).split(',');
}

function firstApiResponse(entries) {
  return {statusCode: 200, data: {data: entries}};
}

describe('tsEpssScores - talks to FIRST directly', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
    Config.DEBUG_MODE_ENABLED = false;
  });

  it('GETs api.first.org with the ids in the cve query parameter', async () => {
    httpCall.mockResolvedValue(firstApiResponse([
      {cve: 'CVE-2024-0001', epss: '0.42', percentile: '0.9', date: '2026-07-01'},
      {cve: 'CVE-2024-0002', epss: '0.01', percentile: '0.5', date: '2026-07-01'}
    ]));

    const epssMap = await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002']);

    expect(httpCall).toHaveBeenCalledTimes(1);
    const [method, url, options] = httpCall.mock.calls[0];
    expect(method).toBe('GET');
    expect(url).toBe('https://api.first.org/data/v1/epss');
    expect(url).toBe(EPSS_API_URL);
    expect(options.params.cve).toBe('CVE-2024-0001,CVE-2024-0002');
    expect(epssMap).toEqual({'CVE-2024-0001': 0.42, 'CVE-2024-0002': 0.01});
  });

  // FIRST returns epss/percentile as STRINGS ("0.97565"), unlike the service
  // that used to sit in front of it.
  it('parses the string scores FIRST returns into numbers', async () => {
    httpCall.mockResolvedValue(firstApiResponse([
      {cve: 'CVE-2021-44228', epss: '0.97565', percentile: '0.99996', date: '2026-06-05'}
    ]));
    expect(await tsEpssScores(['CVE-2021-44228'])).toEqual({'CVE-2021-44228': 0.97565});
  });

  it('sends no API key - the endpoint is public', async () => {
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(['CVE-2024-0001']);
    const options = httpCall.mock.calls[0][2];
    const headerNames = Object.keys(options.headers || {}).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('x-api-key');
  });

  // Without this a hung request holds report generation open for ever, and the
  // smaller batches mean many more chances to hit one.
  it('bounds every request with a timeout', async () => {
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(['CVE-2024-0001']);
    expect(httpCall.mock.calls[0][2].timeoutMs).toBeGreaterThan(0);
  });

  it('dedupes repeated ids into one occurrence', async () => {
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0001', 'CVE-2024-0002']);
    expect(sentCves(0)).toEqual(['CVE-2024-0001', 'CVE-2024-0002']);
  });

  it('never sends a non-CVE id (GHSA-only findings have no EPSS record)', async () => {
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(['GHSA-xxxx-yyyy-zzzz', 'CVE-2024-0001', 'not-an-id']);
    expect(sentCves(0)).toEqual(['CVE-2024-0001']);
  });

  it('makes no call at all when nothing valid is left to ask about', async () => {
    expect(await tsEpssScores([])).toEqual({});
    expect(await tsEpssScores(['GHSA-xxxx-yyyy-zzzz'])).toEqual({});
    expect(await tsEpssScores(null)).toEqual({});
    expect(httpCall).not.toHaveBeenCalled();
  });
});

describe('tsEpssScores - can be switched off', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
  });

  // An air-gapped installation has no route to FIRST; without this every report
  // spends its whole timeout budget on requests that cannot succeed.
  it('makes no outbound call when TS_EPSS_ENABLED is off', async () => {
    Config.TS_EPSS_ENABLED = false;
    expect(await tsEpssScores(['CVE-2024-0001'])).toEqual({});
    expect(httpCall).not.toHaveBeenCalled();
  });
});

describe('tsEpssScores - packs each request up to the cve parameter cap', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
    httpCall.mockResolvedValue(firstApiResponse([]));
  });

  // FIRST answers a `cve` value over 2000 characters with `total: 0` and a 200 -
  // no error, no rows. Measured: 1987 chars is served, 2001 is not. The unit is
  // characters, not ids, because CVE ids are not all the same length.
  function ids(n, year = 2024) {
    return Array.from({length: n}, (_, i) => `CVE-${year}-${String(i + 1).padStart(4, '0')}`);
  }

  it('caps the cve parameter below the length FIRST rejects', async () => {
    await tsEpssScores(ids(600));
    expect(httpCall.mock.calls.length).toBeGreaterThan(1);
    httpCall.mock.calls.forEach((call) => {
      expect(call[2].params.cve.length).toBeLessThanOrEqual(EPSS_MAX_CVE_PARAM_CHARS);
    });
    expect(EPSS_MAX_CVE_PARAM_CHARS).toBeLessThan(2000);
  });

  it('fills each request rather than sending a fixed count', async () => {
    await tsEpssScores(ids(600));
    // Every chunk but the last is packed: one more id would breach the cap.
    const lengths = httpCall.mock.calls.map((call) => call[2].params.cve.length);
    lengths.slice(0, -1).forEach((len) => {
      expect(len + 1 + 13).toBeGreaterThan(EPSS_MAX_CVE_PARAM_CHARS);
    });
  });

  // The point of measuring in characters: longer ids mean fewer per request.
  it('sends fewer long ids than short ones per request', async () => {
    await tsEpssScores(Array.from({length: 400}, (_, i) => `CVE-2024-${String(i + 1).padStart(4, '0')}`));
    const shortPerCall = sentCves(0).length;
    httpCall.mockReset();
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(Array.from({length: 400}, (_, i) => `CVE-2024-${String(i + 1).padStart(9, '0')}`));
    expect(sentCves(0).length).toBeLessThan(shortPerCall);
  });

  // Without an explicit limit the default page size is 100, which would drop
  // every id past the hundredth from a fuller request.
  it('asks for as many rows as the chunk carries, so nothing is truncated', async () => {
    await tsEpssScores(ids(600));
    httpCall.mock.calls.forEach((call) => {
      const sent = String(call[2].params.cve).split(',').length;
      expect(Number(call[2].params.limit)).toBeGreaterThanOrEqual(sent);
    });
  });

  it('sends every id exactly once across the chunks', async () => {
    const all = ids(600);
    await tsEpssScores(all);
    const sent = httpCall.mock.calls.flatMap((_, i) => sentCves(i));
    expect(sent).toHaveLength(600);
    expect(new Set(sent)).toEqual(new Set(all));
  });

  it('dedupes and filters BEFORE packing, so noise never adds a request', async () => {
    await tsEpssScores([...ids(50), ...ids(50), 'GHSA-xxxx-yyyy-zzzz']);
    expect(httpCall).toHaveBeenCalledTimes(1);
  });

  it('merges the results of every chunk into one map', async () => {
    httpCall.mockReset();
    httpCall
      .mockResolvedValueOnce(firstApiResponse([{cve: 'CVE-2024-0001', epss: '0.5'}]))
      .mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0600', epss: '0.25'}]));
    const epssMap = await tsEpssScores(ids(600));
    expect(epssMap['CVE-2024-0001']).toBe(0.5);
    expect(epssMap['CVE-2024-0600']).toBe(0.25);
  });
});

describe('chunkByParamLength - the packing rule on its own', () => {
  it('keeps every joined chunk within the cap', () => {
    const ids = Array.from({length: 500}, (_, i) => `CVE-2024-${String(i).padStart(4, '0')}`);
    chunkByParamLength(ids, 100).forEach((chunk) => {
      expect(chunk.join(',').length).toBeLessThanOrEqual(100);
    });
  });

  it('loses no id and keeps their order', () => {
    const ids = Array.from({length: 500}, (_, i) => `CVE-2024-${String(i).padStart(4, '0')}`);
    expect(chunkByParamLength(ids, 100).flat()).toEqual(ids);
  });

  it('emits a single id that cannot fit rather than dropping it', () => {
    expect(chunkByParamLength(['CVE-2024-0001'], 3)).toEqual([['CVE-2024-0001']]);
  });

  it('returns nothing for no ids', () => {
    expect(chunkByParamLength([], 100)).toEqual([]);
  });
});

describe('tsEpssScores - pages when an answer is capped', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
  });

  // Belt and braces: `limit` is set to the chunk size, so this should not
  // happen - but an answer that reports more rows than it carried must not
  // silently lose the remainder.
  it('fetches the next page when total exceeds the rows returned', async () => {
    httpCall
      .mockResolvedValueOnce({statusCode: 200, data: {
        total: 2, offset: 0, limit: 1, data: [{cve: 'CVE-2024-0001', epss: '0.5'}]
      }})
      .mockResolvedValueOnce({statusCode: 200, data: {
        total: 2, offset: 1, limit: 1, data: [{cve: 'CVE-2024-0002', epss: '0.25'}]
      }});

    const epssMap = await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002']);

    expect(httpCall).toHaveBeenCalledTimes(2);
    expect(Number(httpCall.mock.calls[1][2].params.offset)).toBe(1);
    expect(epssMap).toEqual({'CVE-2024-0001': 0.5, 'CVE-2024-0002': 0.25});
  });

  it('does not page when the answer is complete', async () => {
    httpCall.mockResolvedValue({statusCode: 200, data: {
      total: 1, offset: 0, limit: 100, data: [{cve: 'CVE-2024-0001', epss: '0.5'}]
    }});
    await tsEpssScores(['CVE-2024-0001']);
    expect(httpCall).toHaveBeenCalledTimes(1);
  });

  // A server that reports a total it never delivers must not spin for ever.
  it('stops paging when a page comes back empty', async () => {
    httpCall.mockResolvedValue({statusCode: 200, data: {
      total: 500, offset: 0, limit: 100, data: []
    }});
    await tsEpssScores(['CVE-2024-0001']);
    expect(httpCall).toHaveBeenCalledTimes(1);
  });
});

describe('tsEpssScores - serves what the cache already knows', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
    httpCall.mockResolvedValue(firstApiResponse([]));
  });

  it('makes no request at all when every id is cached and fresh', async () => {
    cache('CVE-2024-0001', 0.42, 1);
    cache('CVE-2024-0002', 0.01, 23);
    expect(await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002']))
      .toEqual({'CVE-2024-0001': 0.42, 'CVE-2024-0002': 0.01});
    expect(httpCall).not.toHaveBeenCalled();
  });

  it('asks only about the ids the cache is missing', async () => {
    cache('CVE-2024-0001', 0.42, 1);
    httpCall.mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0002', epss: '0.01'}]));
    const epssMap = await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002']);
    expect(sentCves(0)).toEqual(['CVE-2024-0002']);
    expect(epssMap).toEqual({'CVE-2024-0001': 0.42, 'CVE-2024-0002': 0.01});
  });

  it('refetches an entry older than the freshness window', async () => {
    cache('CVE-2024-0001', 0.42, 25);
    httpCall.mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0001', epss: '0.99'}]));
    expect(await tsEpssScores(['CVE-2024-0001'])).toEqual({'CVE-2024-0001': 0.99});
    expect(sentCves(0)).toEqual(['CVE-2024-0001']);
  });

  it('writes what it fetched back to the cache', async () => {
    httpCall.mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0001', epss: '0.42', percentile: '0.9', date: '2026-09-21'}]));
    await tsEpssScores(['CVE-2024-0001']);
    expect(written()).toEqual({'CVE-2024-0001': 0.42});
  });

  // Otherwise a report full of unscored findings re-asks about all of them on
  // every run.
  it('records an id FIRST has no score for, so it is not re-asked', async () => {
    httpCall.mockResolvedValue(firstApiResponse([]));
    await tsEpssScores(['CVE-2026-99999']);
    expect(written()).toEqual({'CVE-2026-99999': null});
  });

  it('serves a cached miss without asking again', async () => {
    cache('CVE-2026-99999', null, 1);
    expect(await tsEpssScores(['CVE-2026-99999'])).toEqual({});
    expect(httpCall).not.toHaveBeenCalled();
  });

  it('writes nothing when the request failed, so a blip is not cached as a miss', async () => {
    httpCall.mockRejectedValue(new Error('unreachable'));
    await tsEpssScores(['CVE-2024-0001']);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  it('never lets a cache failure fail the lookup', async () => {
    mockBulkWrite.mockRejectedValue(new Error('mongo is down'));
    httpCall.mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0001', epss: '0.42'}]));
    expect(await tsEpssScores(['CVE-2024-0001'])).toEqual({'CVE-2024-0001': 0.42});
  });
});

describe('tsEpssScores - an EPSS outage never fails a report', () => {
  beforeEach(() => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
  });

  it('returns {} when the request rejects', async () => {
    httpCall.mockRejectedValue(new Error('ETIMEDOUT'));
    expect(await tsEpssScores(['CVE-2024-0001'])).toEqual({});
  });

  it('returns {} when the response has no data array', async () => {
    httpCall.mockResolvedValue({statusCode: 200, data: {status: 'error'}});
    expect(await tsEpssScores(['CVE-2024-0001'])).toEqual({});
  });

  // Enough ids to need more than one request under the cve-parameter cap.
  it('keeps the scores of the chunks that succeeded when one fails', async () => {
    const ids = Array.from({length: 300}, (_, i) => `CVE-2024-${String(i + 1).padStart(4, '0')}`);
    httpCall
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(firstApiResponse([{cve: 'CVE-2024-0300', epss: '0.25'}]));
    expect(await tsEpssScores(ids)).toEqual({'CVE-2024-0300': 0.25});
  });

  it('skips malformed entries without discarding the rest', async () => {
    httpCall.mockResolvedValue(firstApiResponse([
      {cve: 'CVE-2024-0001', epss: '0.42'},
      {cve: 'CVE-2024-0002', epss: 'not-a-number'},
      {cve: 42, epss: '0.1'},
      null,
      {epss: '0.3'},
      {cve: 'CVE-2024-0003', epss: '0.7'}
    ]));
    expect(await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002', 'CVE-2024-0003']))
      .toEqual({'CVE-2024-0001': 0.42, 'CVE-2024-0003': 0.7});
  });
});

describe('resolveEpss - floor + pass-through', () => {
  it('floors a cveId missing from the map', () => {
    expect(resolveEpss('CVE-2024-0001', {})).toEqual({score: 0.001, floored: true});
  });

  it('passes a real score through as-is', () => {
    expect(resolveEpss('CVE-2024-0001', {'CVE-2024-0001': 0.42}))
      .toEqual({score: 0.42, floored: false});
  });

  // A genuinely tiny measured score is not an unknown and must not be relabelled
  // as one on the chart.
  it('reports floored: false for a real score smaller than the floor', () => {
    expect(resolveEpss('CVE-2024-0001', {'CVE-2024-0001': 0.0005}))
      .toEqual({score: 0.0005, floored: false});
  });

  it('reports floored: false for a genuine score equal to the floor', () => {
    expect(resolveEpss('CVE-2024-0001', {'CVE-2024-0001': 0.001}))
      .toEqual({score: 0.001, floored: false});
  });

  it('floors a non-CVE key, which can never be in the map', () => {
    expect(resolveEpss('GHSA-xxxx-yyyy-zzzz', {}).floored).toBe(true);
  });

  it('never returns 0, NaN, null or undefined', () => {
    for (const map of [{}, {'CVE-2024-0001': 0}, {'CVE-2024-0001': NaN},
      {'CVE-2024-0001': null}, {'CVE-2024-0001': -1}, {'CVE-2024-0001': 'x'}]) {
      const {score} = resolveEpss('CVE-2024-0001', map);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThan(0);
    }
  });

  it('never throws for missing arguments', () => {
    expect(() => resolveEpss()).not.toThrow();
    expect(resolveEpss(undefined, undefined).floored).toBe(true);
  });
});

describe('composed: an EPSS outage floors every finding', () => {
  it('floors them all, and throws nothing', async () => {
    httpCall.mockReset();
    mockBulkWrite.mockReset();
    mockCacheRows.length = 0;
    Config.TS_EPSS_ENABLED = true;
    httpCall.mockRejectedValue(new Error('unreachable'));
    const epssMap = await tsEpssScores(['CVE-2024-0001', 'CVE-2024-0002']);
    for (const id of ['CVE-2024-0001', 'CVE-2024-0002']) {
      expect(resolveEpss(id, epssMap)).toEqual({score: 0.001, floored: true});
    }
  });
});

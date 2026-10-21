import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryBatch, fetchRecords, isOsvId, BATCH_SIZE } from '../../../analysis/services/osv/client.js';
import { startFakeOsv, osvRecord } from '../helpers/fakeOsv.js';

let osv;

function query(name, version) {
  return { id: 'pair-' + name + '@' + version, key: 'npm:' + name, version, package: { ecosystem: 'npm', name } };
}

function soon(ms = 60000) {
  return Date.now() + ms;
}

before(async () => { osv = await startFakeOsv(); });
after(async () => { await osv.close(); });
beforeEach(() => {
  osv.state.lists.clear();
  osv.state.records.clear();
  osv.state.requests.length = 0;
  osv.state.maxInflight = 0;
  osv.state.failQuerybatch = false;
  osv.state.reply = null;
});

describe('isOsvId', () => {
  it('accepts OSV ids and refuses anything that could leave the path segment', () => {
    assert.equal(isOsvId('GHSA-35jh-r3h4-6jhm'), true);
    assert.equal(isOsvId('PYSEC-2021-19'), true);
    assert.equal(isOsvId('../etc/passwd'), false);
    assert.equal(isOsvId('a/b'), false);
    assert.equal(isOsvId(''), false);
    assert.equal(isOsvId({}), false);
  });
});

describe('queryBatch', () => {
  it('sends package and version and answers per query, in order', async () => {
    osv.state.lists.set('npm/lodash@4.17.20', [{ id: 'GHSA-35jh-r3h4-6jhm', modified: 'M1' }, { id: '../bad', modified: 'x' }]);

    const answers = await queryBatch([query('lodash', '4.17.20'), query('left-pad', '1.0.0')],
      { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(answers, [[{ id: 'GHSA-35jh-r3h4-6jhm', modified: 'M1' }], []]);
    assert.deepEqual(osv.querybatchCalls()[0].body, {
      queries: [
        { package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.20' },
        { package: { ecosystem: 'npm', name: 'left-pad' }, version: '1.0.0' }
      ]
    });
  });

  it('splits into sequential requests of at most BATCH_SIZE queries', async () => {
    const queries = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => query('p' + i, '1.0.0'));

    const answers = await queryBatch(queries, { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(osv.querybatchCalls().map(call => call.body.queries.length), [BATCH_SIZE, 1]);
    assert.equal(osv.state.maxInflight, 1);
    assert.equal(answers.length, BATCH_SIZE + 1);
    assert.ok(answers.every(answer => Array.isArray(answer) && answer.length === 0));
  });

  it('follows next_page_token for the queries that have more pages', async () => {
    osv.state.reply = (entry) => {
      if (entry.url !== '/querybatch') {
        return null;
      }
      const first = entry.body.queries[0];
      if (!first.page_token) {
        return { status: 200, json: { results: [{ vulns: [{ id: 'A-1', modified: 'm' }], next_page_token: 'p2' }, {}] } };
      }
      return { status: 200, json: { results: [{ vulns: [{ id: 'A-2', modified: 'm' }] }] } };
    };

    const answers = await queryBatch([query('a', '1'), query('b', '1')], { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(answers, [[{ id: 'A-1', modified: 'm' }, { id: 'A-2', modified: 'm' }], []]);
    assert.deepEqual(osv.querybatchCalls()[1].body.queries,
      [{ package: { ecosystem: 'npm', name: 'a' }, version: '1', page_token: 'p2' }]);
  });

  it('answers null for a query still paging after ten rounds', async () => {
    osv.state.reply = (entry) => ({ status: 200, json: { results: entry.body.queries.map(() => ({ vulns: [], next_page_token: 'again' })) } });

    const answers = await queryBatch([query('a', '1')], { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(answers, [null]);
    assert.equal(osv.querybatchCalls().length, 10);
  });

  it('answers null for every query of a failed request and stops', async () => {
    osv.state.failQuerybatch = true;
    const queries = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => query('p' + i, '1.0.0'));

    const answers = await queryBatch(queries, { baseUrl: osv.baseUrl, deadline: soon() });

    assert.ok(answers.every(answer => answer === null));
    assert.equal(osv.querybatchCalls().length, 1);
  });

  it('goes on with the next request after one OSV rejects', async () => {
    const queries = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => query('p' + i, '1.0.0'));
    osv.state.lists.set('npm/p' + BATCH_SIZE + '@1.0.0', [{ id: 'A-1', modified: 'm' }]);
    let calls = 0;
    osv.state.reply = (entry) => (entry.url === '/querybatch' && calls++ === 0
      ? { status: 400, json: { code: 3, message: 'Invalid query' } }
      : null);

    const answers = await queryBatch(queries, { baseUrl: osv.baseUrl, deadline: soon() });

    assert.equal(osv.querybatchCalls().length, 2);
    assert.ok(answers.slice(0, BATCH_SIZE).every(answer => answer === null));
    assert.deepEqual(answers[BATCH_SIZE], [{ id: 'A-1', modified: 'm' }]);
  });

  it('stops when OSV throttles or times a request out', async () => {
    for (const status of [429, 408]) {
      osv.state.requests.length = 0;
      osv.state.reply = (entry) => (entry.url === '/querybatch' ? { status, json: {} } : null);
      const queries = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => query('p' + i, '1.0.0'));

      const answers = await queryBatch(queries, { baseUrl: osv.baseUrl, deadline: soon() });

      assert.ok(answers.every(answer => answer === null));
      assert.equal(osv.querybatchCalls().length, 1);
    }
  });

  it('treats a result list of the wrong length as a failure', async () => {
    osv.state.reply = () => ({ status: 200, json: { results: [] } });

    assert.deepEqual(await queryBatch([query('a', '1')], { baseUrl: osv.baseUrl, deadline: soon() }), [null]);
  });

  it('sends nothing once the deadline has passed', async () => {
    const answers = await queryBatch([query('a', '1')], { baseUrl: osv.baseUrl, deadline: Date.now() - 1 });

    assert.deepEqual(answers, [null]);
    assert.equal(osv.state.requests.length, 0);
  });
});

describe('fetchRecords', () => {
  it('fetches each valid id at most four at a time', async () => {
    const ids = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'];
    ids.forEach(id => osv.state.records.set(id, osvRecord(id)));

    const records = await fetchRecords(ids.concat(['../x']), { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(Array.from(records.keys()).sort(), ids);
    assert.equal(osv.recordCalls().length, ids.length);
    assert.ok(osv.state.maxInflight <= 4, 'at most 4 in flight, saw ' + osv.state.maxInflight);
  });

  it('leaves out ids that failed or answered a different record', async () => {
    osv.state.records.set('A-1', osvRecord('A-1'));
    osv.state.records.set('A-2', osvRecord('SOMETHING-ELSE'));

    const records = await fetchRecords(['A-1', 'A-2', 'MISSING-1'], { baseUrl: osv.baseUrl, deadline: soon() });

    assert.deepEqual(Array.from(records.keys()), ['A-1']);
  });

  it('fetches nothing once the deadline has passed', async () => {
    osv.state.records.set('A-1', osvRecord('A-1'));

    const records = await fetchRecords(['A-1'], { baseUrl: osv.baseUrl, deadline: Date.now() - 1 });

    assert.equal(records.size, 0);
    assert.equal(osv.state.requests.length, 0);
  });
});

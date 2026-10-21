import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Worker } from 'node:worker_threads';

// workers/entry.js is what ts-app starts a thread on: it runs one service call and
// posts exactly one message back.
const ENTRY = new URL('../entry.js', import.meta.url);

function runEntry(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(ENTRY, { workerData });
    worker.once('message', (message) => {
      worker.terminate().then(() => resolve(message));
    });
    worker.once('error', reject);
  });
}

let server, endpoint;

before(async () => {
  server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/hook`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('worker entry', () => {
  it('runs the named service and posts its result', async () => {
    const message = await runEntry({
      service: 'webhook',
      input: { trigger: 'approval', data: { approved: true }, scope: { companyId: 'c1' }, targets: [{ _id: 'w1', type: 'webhook', url: endpoint }] },
      settings: {}
    });

    assert.deepEqual(message, { ok: true, result: [{ status: 200, data: 'ok' }] });
  });

  it('posts the error the service threw', async () => {
    const message = await runEntry({ service: 'webhook', input: { data: { approved: true } }, settings: {} });

    assert.equal(message.ok, false);
    assert.equal(message.error.message, 'targets must be an array');
  });

  it('refuses a service it does not know', async () => {
    const message = await runEntry({ service: '../etc', input: {}, settings: {} });

    assert.equal(message.ok, false);
    assert.equal(message.error.message, 'Unknown worker service: ../etc');
  });
});

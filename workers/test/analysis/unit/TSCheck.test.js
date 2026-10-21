import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { format } from 'node:util';

import { TSCheck } from '../../../analysis/services/TSCheck.js';
import { setSettings } from '../../../analysis/services/Settings.js';

// The CE legal check service (docker/ts-legalcheck-api.py in ts-app) answers
// POST /check-module synchronously with {moduleKey: {componentKey:version:path: {license: result}}}.
let server, requests, base, reply;

before(async () => {
  requests = [];
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : null });
      // Only check-module answers with the configured reply; anything else (a redirect
      // target) is a plain 200, so following a redirect would look like a success.
      const answer = request.url === '/check-module' ? reply : { status: 200, body: {} };
      response.writeHead(answer.status, Object.assign({ 'Content-Type': 'application/json' }, answer.headers || {}));
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests.length = 0;
  reply = { status: 200, body: { 'test-module': { 'npm:a:1.0.0:0': { MIT: { status: 'SAT' } } } } };
});

afterEach(() => {
  mock.restoreAll();
});

describe('TSCheck.CheckModule', () => {
  it('posts the module to check-module once and returns the answer', async () => {
    setSettings({ TS_CHECK_SERVER: base + '/' });

    const response = await TSCheck.CheckModule({ key: 'test-module', components: {} });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/check-module');
    assert.deepEqual(requests[0].body, { key: 'test-module', components: {} });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, reply.body);
  });

  it('accepts the server address without a trailing slash', async () => {
    setSettings({ TS_CHECK_SERVER: base });

    await TSCheck.CheckModule({ key: 'test-module' });

    assert.equal(requests[0].url, '/check-module');
  });

  it('returns an error response instead of throwing', async () => {
    setSettings({ TS_CHECK_SERVER: base });
    reply = { status: 500, body: { error: 'engine failed' } };

    const response = await TSCheck.CheckModule({ key: 'test-module' });

    assert.equal(response.status, 500);
  });

  it('answers 503 without a request when no check server is set', async () => {
    setSettings({});

    const response = await TSCheck.CheckModule({ key: 'test-module' });

    assert.equal(response.status, 503);
    assert.equal(requests.length, 0);
  });

  // A check server that redirects (for example http -> https) must be configured with its
  // final URL: following the redirect would turn the POST into a GET and lose the module.
  it('does not follow a redirect and returns the redirect response', async () => {
    setSettings({ TS_CHECK_SERVER: base });
    reply = { status: 301, headers: { Location: base + '/elsewhere' }, body: {} };
    const lines = [];
    for (const name of ['log', 'info', 'warn', 'error']) {
      mock.method(console, name, (...args) => { lines.push(format(...args)); });
    }

    const response = await TSCheck.CheckModule({ key: 'BODY-MARKER-MODULE' });

    assert.equal(response.status, 301);
    assert.deepEqual(requests.map((entry) => entry.url), ['/check-module']);
    const failure = lines.filter((line) => line.includes('301')).join('\n');
    assert.match(failure, /final URL/);
    assert.equal(failure.includes('BODY-MARKER-MODULE'), false, 'the request body reached the failure log');
  });

  it('answers 503 when the check server cannot be reached', async () => {
    setSettings({ TS_CHECK_SERVER: 'http://127.0.0.1:1/' });

    const response = await TSCheck.CheckModule({ key: 'test-module' });

    assert.equal(response.status, 503);
  });
});

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import { format } from 'node:util';

import { Webhook } from '../../../webhook/services/Webhook.js';

// Webhook.Send against a real local receiver: where the request really goes, what a
// redirect does, and what a failed delivery writes to the log.
let server, hits, port;

before(async () => {
  hits = [];
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      hits.push({ url: request.url, host: request.headers.host });
      if (request.url === '/moved') {
        response.writeHead(302, { Location: '/redirect-target' });
        response.end();
        return;
      }
      if (request.url.startsWith('/failing/')) {
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('receiver broke');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// No unit test may resolve a name for real. Installed after listen(), which looks its own
// host up. A connection that still reaches the system resolver fails loudly instead.
let resolver;
beforeEach(() => {
  hits.length = 0;
  resolver = mock.method(dns, 'lookup', (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const error = new Error('unexpected DNS lookup in a unit test');
    error.code = 'ENOTFOUND';
    process.nextTick(done, error);
  });
});

afterEach(() => {
  mock.restoreAll();
});

function captureConsole() {
  const lines = [];
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    mock.method(console, name, (...args) => { lines.push(format(...args)); });
  }
  return lines;
}

describe('Webhook.Send', () => {
  it('connects only to the pinned addresses, whatever the host name resolves to', async () => {
    captureConsole();
    // .invalid never resolves (RFC 6761): the request can only arrive through the pin.
    const response = await Webhook.Send({
      url: `http://receiver.invalid:${port}/hook`,
      method: 'POST',
      headers: [],
      data: { a: 1 },
      resolvedAddresses: ['127.0.0.1']
    });

    assert.equal(response && response.status, 200);
    assert.deepEqual(hits.map((hit) => hit.url), ['/hook']);
    // The URL keeps its host name, so the receiver (and TLS) still see it.
    assert.equal(hits[0].host, `receiver.invalid:${port}`);
    assert.equal(resolver.mock.callCount(), 0);
  });

  it('ignores a proxy from the environment when the addresses are pinned', async () => {
    captureConsole();
    const saved = { http_proxy: process.env.http_proxy, HTTP_PROXY: process.env.HTTP_PROXY };
    // A proxy that would refuse the connection: through it the delivery could not arrive.
    process.env.http_proxy = 'http://127.0.0.1:1';
    process.env.HTTP_PROXY = 'http://127.0.0.1:1';
    try {
      const response = await Webhook.Send({
        url: `http://receiver.invalid:${port}/hook`,
        method: 'POST',
        headers: [],
        data: { a: 1 },
        resolvedAddresses: ['127.0.0.1']
      });

      assert.equal(response && response.status, 200);
      assert.deepEqual(hits.map((hit) => hit.url), ['/hook']);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('fails closed when no pinned entry is an IP address, without asking the resolver', async () => {
    captureConsole();
    const response = await Webhook.Send({
      url: `http://receiver.invalid:${port}/hook`,
      method: 'POST',
      headers: [],
      data: { a: 1 },
      resolvedAddresses: ['not-an-address']
    });

    assert.equal(typeof response, 'string');
    assert.equal(hits.length, 0);
    assert.equal(resolver.mock.callCount(), 0);
  });

  it('does not follow a redirect', async () => {
    captureConsole();
    const response = await Webhook.Send({
      url: `http://127.0.0.1:${port}/moved`,
      method: 'POST',
      headers: [],
      data: { a: 1 }
    });

    // A 3xx is an error result, not a delivery somewhere else.
    assert.equal(typeof response, 'string');
    assert.match(response, /302/);
    assert.deepEqual(hits.map((hit) => hit.url), ['/moved']);
  });

  it('logs a failed delivery without its url, headers or body', async () => {
    const lines = captureConsole();
    const response = await Webhook.Send({
      url: `http://127.0.0.1:${port}/failing/URL-PATH-TOKEN`,
      method: 'POST',
      headers: [{ key: 'Authorization', value: 'Bearer HEADER-SECRET-VALUE' }],
      data: { note: 'BODY-SECRET-VALUE' }
    });

    assert.equal(typeof response, 'string');
    const output = lines.join('\n');
    assert.match(output, /500/);
    assert.equal(output.includes('URL-PATH-TOKEN'), false, 'the url reached the log');
    assert.equal(output.includes('HEADER-SECRET-VALUE'), false, 'a header value reached the log');
    assert.equal(output.includes('BODY-SECRET-VALUE'), false, 'the body reached the log');
  });
});

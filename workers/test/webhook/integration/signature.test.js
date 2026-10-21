import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { Webhook, signatureHeaders } from '../../../webhook/services/Webhook.js';

// Deliveries carry an HMAC signature the receiver can verify with the webhook's
// signing secret (#48).
let server, received, port;

before(async () => {
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = { headers: request.headers, body };
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

function expectedSignature(secret, timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('Webhook signature', () => {
  it('signs the timestamp and the exact body', () => {
    const headers = signatureHeaders('s3cret', '{"a":1}', 1700000000123);
    assert.equal(headers['X-TrustSource-Timestamp'], '1700000000');
    assert.equal(headers['X-TrustSource-Signature'], expectedSignature('s3cret', '1700000000', '{"a":1}'));
  });

  it('adds nothing without a signing secret', () => {
    assert.deepEqual(signatureHeaders(undefined, '{}'), {});
    assert.deepEqual(signatureHeaders('', '{}'), {});
  });

  it('sends a signature that verifies against the body the receiver got', async () => {
    const data = { event: 'release', items: ['ü', 2] };
    const response = await Webhook.Send({
      url: `http://127.0.0.1:${port}/hook`, method: 'POST', headers: [{ key: 'X-Extra', value: '1' }],
      data, signingSecret: 'receiver-secret', resolvedAddresses: ['127.0.0.1']
    });
    assert.equal(response.status, 200);
    assert.equal(received.body, JSON.stringify(data));
    assert.equal(received.headers['x-extra'], '1');
    const timestamp = received.headers['x-trustsource-timestamp'];
    assert.match(timestamp, /^\d+$/);
    assert.equal(received.headers['x-trustsource-signature'],
      expectedSignature('receiver-secret', timestamp, received.body));
  });
});

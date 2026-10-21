import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { run } from '../../../webhook/index.js';

// A real HTTP round trip through axios: what a Slack / Teams / generic receiver
// actually gets on the wire, rather than what the renderer returns.
let server, received, endpoint;

const APP_URL = 'https://ts.example.org/';
const SCOPE = { companyId: 'eZ2mTNT8dKvutDHi4', projectId: 'P1', projectName: 'Payments' };
const GROUPED_DATA = {
  moduleId: 'M1', moduleName: 'checkout-api', scope: 'project',
  projectId: 'P1', projectName: 'Payments', releaseId: null, releaseName: null,
  cves: ['CVE-2020-8203', 'CVE-2021-44228'],
  components: [{
    componentKey: 'maven:org.apache.logging.log4j/log4j-core',
    versions: ['2.14.1'], cves: ['CVE-2021-44228'], severity: 'critical'
  }],
  severity: 'critical', detectedAt: '2026-09-08T10:00:00.000Z'
};

before(async () => {
  received = [];
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push({ headers: request.headers, body: JSON.parse(body) });
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/hook`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

afterEach(() => {
  received.length = 0;
});

function target(type) {
  return { _id: 'wh1', name: 'VULN_ALERTS', type, url: endpoint, headers: [{ key: 'x-ts-test', value: 'yes' }] };
}

function deliver(targets) {
  return run({ trigger: 'vulnerabilitiesByModule', data: GROUPED_DATA, scope: SCOPE, targets }, { APP_URL });
}

describe('Integration: what the receiver gets on the wire', () => {

  it('POSTs Block Kit blocks to a slack receiver', async () => {
    const result = await deliver([target('slack')]);

    assert.deepEqual(result, [{ status: 200, data: 'ok' }]);
    assert.equal(received.length, 1);
    assert.equal(received[0].headers['x-ts-test'], 'yes');
    assert.equal(received[0].headers['content-type'], 'application/json');
    const blocks = received[0].body.blocks;
    assert.ok(Array.isArray(blocks));
    assert.equal(JSON.stringify(blocks).includes('"uri"'), false);
    assert.equal(blocks.find(item => item.type === 'actions').elements[0].url,
      'https://ts.example.org/projects/P1/modules/M1/dependencies');
  });

  it('POSTs a MessageCard to a teams receiver', async () => {
    await deliver([target('teams')]);

    assert.equal(received[0].body['@type'], 'MessageCard');
    assert.ok(received[0].body.sections[0].activitySubtitle.includes('checkout-api'));
  });

  it('POSTs an adaptive card to a teamsWorkflow receiver', async () => {
    await deliver([target('teamsWorkflow')]);

    assert.equal(received[0].body.attachments[0].content.type, 'AdaptiveCard');
  });

  // The contract the issue measured and asked to keep: byte-identical.
  it('POSTs the grouped payload verbatim to a generic webhook receiver', async () => {
    await deliver([target('webhook')]);

    assert.deepEqual(received[0].body, GROUPED_DATA);
    assert.equal(JSON.stringify(received[0].body), JSON.stringify(GROUPED_DATA));
  });

  it('delivers one message per target', async () => {
    const result = await deliver([target('slack'), target('teams')]);

    assert.equal(received.length, 2);
    assert.equal(result.length, 2);
  });
});

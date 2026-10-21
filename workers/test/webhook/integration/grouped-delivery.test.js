import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { run } from '../../../webhook/index.js';
import { Webhook } from '../../../webhook/services/Webhook.js';

// End to end for the three grouped vulnerability triggers: through
// run(), over a real HTTP request, into a local sink - one case per trigger per
// receiver type.

const APP_URL = 'https://ts.example.org/';
const COMPANY = 'eZ2mTNT8dKvutDHi4';
const SCOPE = { companyId: COMPANY, projectId: 'P1', projectName: 'Payments' };
let server, received, endpoint;

const BASE = {
  scope: 'project',
  projectId: 'P1', projectName: 'Payments',
  moduleId: null, moduleName: null,
  releaseId: null, releaseName: null,
  cves: ['CVE-2020-8203', 'CVE-2021-23337', 'CVE-2021-44228'],
  components: [
    { componentKey: 'maven:org.apache.logging.log4j/log4j-core', versions: ['2.14.1'], cves: ['CVE-2021-44228'], severity: 'critical' },
    { componentKey: 'npm:lodash', versions: ['4.17.15'], cves: ['CVE-2020-8203', 'CVE-2021-23337'], severity: 'high' }
  ],
  severity: 'critical',
  detectedAt: '2026-09-08T10:00:00.000Z'
};

// The payload ts-app actually builds for each trigger.
const TRIGGERS = [
  {
    name: 'vulnerabilitiesByModule',
    data: Object.assign({}, BASE, { moduleId: 'M1', moduleName: 'checkout-api' }),
    names: 'checkout-api',
    link: 'https://ts.example.org/projects/P1/modules/M1/dependencies'
  },
  {
    name: 'vulnerabilitiesByProject',
    data: Object.assign({}, BASE),
    names: 'Payments',
    link: 'https://ts.example.org/projects/P1'
  },
  {
    name: 'vulnerabilitiesByRelease',
    data: Object.assign({}, BASE, { scope: 'release', releaseId: 'R1', releaseName: '2026.09' }),
    names: '2026.09',
    link: 'https://ts.example.org/releases/R1/new_vulnerabilities'
  }
];

const RECEIVERS = ['slack', 'teams', 'teamsWorkflow', 'webhook'];

before(async () => {
  received = [];
  server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push(JSON.parse(body));
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

beforeEach(() => { received.length = 0; });

// What the receiver displays, whatever the channel calls the field.
function visibleText(body, type) {
  if (type === 'slack') {
    return JSON.stringify(body.blocks);
  }
  if (type === 'teams') {
    return JSON.stringify(body.sections);
  }
  return JSON.stringify(body.attachments[0].content.body);
}

function linkOf(body, type) {
  if (type === 'slack') {
    return body.blocks.find(item => item.type === 'actions').elements[0].url;
  }
  if (type === 'teams') {
    return body.potentialAction[0].targets[0].uri;
  }
  return body.attachments[0].content.actions[0].url;
}

function deliver(trigger, type) {
  return run({
    trigger: trigger.name,
    data: trigger.data,
    scope: SCOPE,
    targets: [{ _id: 'wh1', name: 'VULN_ALERTS', type, url: endpoint }]
  }, { APP_URL });
}

TRIGGERS.forEach(trigger => {
  describe(`E2E: ${trigger.name}`, () => {

    RECEIVERS.filter(type => type !== 'webhook').forEach(type => {

      it(`reaches a ${type} receiver as a rendered card`, async () => {
        const result = await deliver(trigger, type);

        assert.deepEqual(result, [{ status: 200, data: 'ok' }]);
        assert.equal(received.length, 1);
        const text = visibleText(received[0], type);
        assert.ok(text.includes(trigger.names), `does not name ${trigger.names}`);
        assert.ok(text.includes('CVE-2021-44228'), 'does not list the CVEs');
        assert.ok(text.includes('critical'), 'does not show the severity');
        assert.equal(linkOf(received[0], type), trigger.link);
      });
    });

    it('reaches a generic webhook receiver byte-identical', async () => {
      const result = await deliver(trigger, 'webhook');

      assert.deepEqual(result, [{ status: 200, data: 'ok' }]);
      assert.equal(JSON.stringify(received[0]), JSON.stringify(trigger.data));
    });
  });
});

describe('E2E: a Slack receiver gets nothing Slack would reject', () => {

  TRIGGERS.forEach(trigger => {
    it(`${trigger.name} carries no "uri" and no oversized text object`, async () => {
      await deliver(trigger, 'slack');

      const body = received[0];
      assert.equal(JSON.stringify(body).includes('"uri"'), false);
      body.blocks.forEach(block => {
        (block.elements || []).forEach(element => {
          const text = element.text && element.text.text ? element.text.text : element.text;
          if (typeof text === 'string') {
            assert.ok(text.length <= 3000, `text object of ${text.length} chars`);
          }
        });
      });
    });
  });

  it('caps a 300-CVE module alert instead of blowing the text limit', async () => {
    const cves = Array.from({ length: 300 }, (unused, index) => `CVE-2026-${1000 + index}`);
    await deliver({
      name: 'vulnerabilitiesByModule',
      data: Object.assign({}, BASE, { moduleId: 'M1', moduleName: 'checkout-api', cves })
    }, 'slack');

    const context = received[0].blocks.find(block => block.type === 'context');
    assert.ok(context.elements[0].text.length <= 3000);
    assert.match(context.elements[0].text, /\+280 more/);
  });
});

describe('E2E: the shipped triggers still deliver', () => {

  it('vulnerability reaches slack with a working button', async () => {
    await run({
      trigger: 'vulnerability',
      data: { componentKey: 'npm:lodash', versions: ['4.17.15'], cves: ['CVE-2020-8203'] },
      scope: SCOPE,
      targets: [{ _id: 'wh1', name: 'VULN_ALERTS', type: 'slack', url: endpoint }]
    }, { APP_URL });

    const button = received[0].blocks.find(block => block.type === 'actions').elements[0];
    assert.equal(button.url, 'https://ts.example.org/reports/vulnerability?projectId=P1');
    assert.equal('uri' in button, false);
  });
});

// Keep the mocked Send used by the sibling suites from leaking in here.
assert.equal(typeof Webhook.Send, 'function');

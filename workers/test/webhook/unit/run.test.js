import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../../../webhook/index.js';
import { Webhook } from '../../../webhook/services/Webhook.js';

// run() delivers one webhook event to the targets ts-app already resolved and
// egress-checked (imports/startup/server/ts-webhook.js). It has no database.

const GROUPED_DATA = {
  moduleId: 'M1', moduleName: 'checkout-api', scope: 'project',
  projectId: 'P1', projectName: 'Payments', releaseId: null, releaseName: null,
  cves: ['CVE-2021-44228'],
  components: [{ componentKey: 'maven:log4j', versions: ['2.14.1'], cves: ['CVE-2021-44228'], severity: 'critical' }],
  severity: 'critical', detectedAt: '2026-09-08T10:00:00.000Z'
};
const SCOPE = { companyId: 'eZ2mTNT8dKvutDHi4', projectId: 'P1', projectName: 'Payments' };

function target(overrides) {
  return Object.assign({
    _id: 'wh1', name: 'VULN_ALERTS', type: 'slack', url: 'https://hooks.slack.com/services/T/B/x'
  }, overrides || {});
}

describe('webhook run', () => {
  let sent;

  beforeEach(() => {
    sent = [];
    mock.method(Webhook, 'Send', async (params) => {
      sent.push(params);
      return { status: 200, data: 'ok' };
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('delivers a rendered card to every target', async () => {
    const result = await run({ trigger: 'vulnerabilitiesByModule', data: GROUPED_DATA, scope: SCOPE, targets: [target()] });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://hooks.slack.com/services/T/B/x');
    assert.equal(sent[0].method, 'POST');
    assert.ok(Array.isArray(sent[0].data.blocks), 'raw payload was POSTed to Slack');
    assert.deepEqual(result, [{ status: 200, data: 'ok' }]);
  });

  it('passes the payload through verbatim for a generic webhook target', async () => {
    await run({ trigger: 'vulnerabilitiesByModule', data: GROUPED_DATA, scope: SCOPE, targets: [target({ type: 'webhook' })] });

    assert.deepEqual(sent[0].data, GROUPED_DATA);
  });

  it('keeps the method and headers of the target', async () => {
    await run({
      trigger: 'approval', data: { approved: true }, scope: SCOPE,
      targets: [target({ type: 'webhook', method: 'PUT', headers: [{ key: 'x-ts', value: '1' }] })]
    });

    assert.equal(sent[0].method, 'PUT');
    assert.deepEqual(sent[0].headers, [{ key: 'x-ts', value: '1' }]);
  });

  it('hands the addresses ts-app checked to the delivery, so it connects only to them', async () => {
    await run({
      trigger: 'approval', data: { approved: true }, scope: SCOPE,
      targets: [target({ type: 'webhook', resolvedAddresses: ['93.184.216.34'] })]
    });

    assert.deepEqual(sent[0].resolvedAddresses, ['93.184.216.34']);
  });

  it('answers one entry per target, in target order', async () => {
    mock.restoreAll();
    mock.method(Webhook, 'Send', async (params) => {
      if (params.url.endsWith('/slow')) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { status: 201, data: 'slow' };
      }
      return { status: 200, data: 'fast' };
    });

    const result = await run({
      trigger: 'approval', data: { approved: true }, scope: SCOPE,
      targets: [target({ type: 'webhook', url: 'https://example.com/slow' }), target({ type: 'webhook', url: 'https://example.com/fast' })]
    });

    assert.deepEqual(result, [{ status: 201, data: 'slow' }, { status: 200, data: 'fast' }]);
  });

  it('reports a failed delivery without failing the others', async () => {
    mock.restoreAll();
    mock.method(Webhook, 'Send', async (params) => (params.url.endsWith('/down')
      ? 'connect ECONNREFUSED'
      : { status: 200, data: 'ok' }));

    const result = await run({
      trigger: 'approval', data: { approved: true }, scope: SCOPE,
      targets: [target({ type: 'webhook', url: 'https://example.com/down' }), target({ type: 'webhook', url: 'https://example.com/up' })]
    });

    assert.deepEqual(result, [{ errorMessage: 'connect ECONNREFUSED' }, { status: 200, data: 'ok' }]);
  });

  it('refuses input without a targets array', async () => {
    await assert.rejects(run({ trigger: 'approval', data: { approved: true }, scope: SCOPE }), /targets must be an array/);
  });

  it('refuses input without data', async () => {
    await assert.rejects(run({ trigger: 'approval', scope: SCOPE, targets: [] }), /data is required/);
  });
});

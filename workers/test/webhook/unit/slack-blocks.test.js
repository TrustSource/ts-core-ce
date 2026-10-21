import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Webhook } from '../../../webhook/services/Webhook.js';

const SLACK = { _id: 'wh1', name: 'EVENT_TO_SLACK', type: 'slack' };
const PARAMS = {
  companyId: 'CO', projectId: 'P1', projectName: 'Payments',
  moduleId: 'M1', moduleName: 'checkout-api'
};

// One `data` shaped so every trigger's renderer finds what it reads.
const DATA = {
  _id: 'DOC_ID',
  moduleId: 'M1',
  closedByName: 'Jane Doe',
  approved: true,
  componentKey: 'maven:org.apache.logging.log4j/log4j-core',
  versions: ['2.14.1'],
  cves: ['CVE-2021-44228']
};

const APP_URL = 'https://ts.example.org/';

const SHIPPED_TRIGGERS = ['analysis', 'release', 'vulnerability', 'approval', 'task'];

function actionElements(payload) {
  const block = (payload.blocks || []).find(item => item.type === 'actions');
  return (block && block.elements) || [];
}

describe('Unit: Slack Block Kit buttons', () => {

  // Block Kit requires `url` on a button element. Slack rejects an unknown
  // field inside a block element with invalid_blocks, so a button carrying
  // `uri` fails the whole message at the receiver.
  SHIPPED_TRIGGERS.forEach(trigger => {
    it(`renders the "${trigger}" button with url and never uri`, () => {
      const elements = actionElements(Webhook.GetDataBySlack(SLACK, trigger, DATA, PARAMS, APP_URL));

      assert.equal(elements.length, 1, 'expected exactly one button element');
      assert.equal(typeof elements[0].url, 'string');
      assert.ok(elements[0].url.startsWith('https://ts.example.org/'));
      assert.equal('uri' in elements[0], false, 'Block Kit has no "uri" field');
    });
  });

  it('carries no "uri" key anywhere in any shipped Slack payload', () => {
    SHIPPED_TRIGGERS.forEach(trigger => {
      const rendered = JSON.stringify(Webhook.GetDataBySlack(SLACK, trigger, DATA, PARAMS, APP_URL));
      assert.equal(rendered.includes('"uri"'), false, `"${trigger}" still emits a "uri" key`);
    });
  });
});

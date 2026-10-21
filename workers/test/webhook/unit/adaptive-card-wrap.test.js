import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Webhook } from '../../../webhook/services/Webhook.js';

const TEAMS_WORKFLOW = { _id: 'wh1', name: 'WH2025', type: 'teamsWorkflow' };
const PARAMS = {
  companyId: 'CO', projectId: 'P1', projectName: 'Payments',
  moduleId: 'M1', moduleName: 'checkout-api'
};

// One `data` shaped so every trigger's renderer finds what it reads.
const DATA = {
  _id: 'DOC_ID',
  moduleId: 'M1',
  moduleName: 'checkout-api',
  releaseId: 'R1',
  releaseName: '2026.09',
  projectId: 'P1',
  severity: 'high',
  closedByName: 'Jane Doe',
  approved: true,
  componentKey: 'npm:ws',
  versions: ['6.1.0', '6.1.1', '6.0.0', '6.2.0', '7.2.4', '5.1.0', '7.1.0', '5.2.3'],
  cves: ['CVE-2021-32640', 'CVE-2024-37890']
};

const ALL_TRIGGERS = [
  'analysis', 'release', 'vulnerability', 'approval', 'task',
  'vulnerabilitiesByModule', 'vulnerabilitiesByProject', 'vulnerabilitiesByRelease'
];

function textBlocks(payload) {
  const content = payload.attachments[0].content;
  return content.body.filter(item => item.type === 'TextBlock');
}

describe('Unit: Adaptive Card text wrapping', () => {

  // An Adaptive Card TextBlock defaults to wrap:false, and Teams then clips the
  // line to the card width and ends it with an ellipsis. Every line these cards
  // carry - a component with its versions and CVEs, a module or project name -
  // is longer than one card width, so none of them may leave wrap unset.
  ALL_TRIGGERS.forEach(trigger => {
    it(`wraps every TextBlock of the "${trigger}" card`, () => {
      const blocks = textBlocks(Webhook.GetDataByTeamsWorkflow(TEAMS_WORKFLOW, trigger, DATA, PARAMS));

      assert.ok(blocks.length > 0, 'expected the card to carry TextBlocks');
      blocks.forEach(block => {
        assert.equal(block.wrap, true, `"${block.text}" would be cropped to one line`);
      });
    });
  });
});

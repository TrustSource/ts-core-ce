import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Webhook } from '../../../webhook/services/Webhook.js';

// The payload ts-app sends for the three grouped triggers.
// One shape for all three: moduleId/moduleName are null for byProject and
// byRelease, releaseId/releaseName are set only for byRelease.
function moduleData(overrides) {
  return Object.assign({
    moduleId: 'M1',
    moduleName: 'checkout-api',
    scope: 'project',
    projectId: 'P1',
    projectName: 'Payments',
    releaseId: null,
    releaseName: null,
    cves: ['CVE-2020-8203', 'CVE-2021-23337', 'CVE-2021-44228'],
    components: [{
      componentKey: 'maven:org.apache.logging.log4j/log4j-core',
      versions: ['2.14.1'],
      cves: ['CVE-2021-44228'],
      severity: 'critical'
    }],
    severity: 'critical',
    detectedAt: '2026-09-08T10:00:00.000Z'
  }, overrides || {});
}

const PROJECT_DATA = moduleData({ moduleId: null, moduleName: null });
const RELEASE_DATA = moduleData({
  moduleId: null, moduleName: null, scope: 'release',
  releaseId: 'R1', releaseName: '2026.09'
});

// ts-app's envelope carries companyId/projectId/projectName only; module
// identity travels inside `data`.
const PARAMS = { companyId: 'CO', projectId: 'P1', projectName: 'Payments' };

const APP_URL = 'https://ts.example.org/';

const BY_MODULE = 'vulnerabilitiesByModule';
const BY_PROJECT = 'vulnerabilitiesByProject';
const BY_RELEASE = 'vulnerabilitiesByRelease';

const CHANNELS = [
  { type: 'slack', render: Webhook.GetDataBySlack },
  { type: 'teams', render: Webhook.GetDataByTeams },
  { type: 'teamsWorkflow', render: Webhook.GetDataByTeamsWorkflow }
];

const CASES = [
  { trigger: BY_MODULE, data: moduleData() },
  { trigger: BY_PROJECT, data: PROJECT_DATA },
  { trigger: BY_RELEASE, data: RELEASE_DATA }
];

function hook(type) {
  return { _id: 'wh1', name: 'VULN_ALERTS', type };
}

function render(type, trigger, data) {
  const channel = CHANNELS.find(item => item.type === type);
  return channel.render(hook(type), trigger, data, PARAMS, APP_URL);
}

// Every string a channel payload carries, flattened, so a content assertion
// does not have to know each channel's block layout.
function texts(payload) {
  const found = [];
  (function walk(node) {
    if (typeof node === 'string') { found.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') { Object.values(node).forEach(walk); }
  })(payload);
  return found;
}

// Every colour a channel payload carries, under whichever key that channel uses.
function colours(payload) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, value]) => {
        if (key === 'color' || key === 'themeColor') { found.push(value); return; }
        walk(value);
      });
    }
  })(payload);
  return found;
}

function linkOf(payload, type) {
  if (type === 'slack') {
    const block = payload.blocks.find(item => item.type === 'actions');
    return block.elements[0].url;
  }
  if (type === 'teams') {
    return payload.potentialAction[0].targets[0].uri;
  }
  return payload.attachments[0].content.actions[0].url;
}

describe('Unit: grouped vulnerability triggers are rendered, not passed through', () => {

  CHANNELS.forEach(channel => {
    CASES.forEach(testCase => {
      it(`${channel.type} renders a card for ${testCase.trigger}`, () => {
        const result = render(channel.type, testCase.trigger, testCase.data);

        assert.notEqual(result, testCase.data, 'raw payload was passed through');
        if (channel.type === 'slack') {
          assert.ok(Array.isArray(result.blocks) && result.blocks.length);
        } else if (channel.type === 'teams') {
          assert.equal(result['@type'], 'MessageCard');
        } else {
          assert.ok(Array.isArray(result.attachments) && result.attachments.length);
        }
      });
    });
  });

  it('leaves an unknown trigger untouched, as before', () => {
    const data = moduleData();
    CHANNELS.forEach(channel => {
      assert.equal(channel.render(hook(channel.type), 'somethingElse', data, PARAMS), data);
    });
  });
});

describe('Unit: grouped vulnerability content', () => {

  CHANNELS.forEach(channel => {

    it(`${channel.type} names the module and lists every CVE for ${BY_MODULE}`, () => {
      const body = texts(render(channel.type, BY_MODULE, moduleData()))
        .find(text => text.includes('checkout-api'));

      assert.ok(body, 'no rendered text names the module');
      assert.ok(body.includes('CVE-2020-8203'));
      assert.ok(body.includes('CVE-2021-23337'));
      assert.ok(body.includes('CVE-2021-44228'));
    });

    it(`${channel.type} names the project for ${BY_PROJECT}`, () => {
      const body = texts(render(channel.type, BY_PROJECT, PROJECT_DATA))
        .find(text => text.includes('Payments') && text.includes('CVE-2021-44228'));

      assert.ok(body, 'no rendered text names the project alongside the CVEs');
    });

    it(`${channel.type} names the release for ${BY_RELEASE}`, () => {
      const body = texts(render(channel.type, BY_RELEASE, RELEASE_DATA))
        .find(text => text.includes('2026.09') && text.includes('CVE-2021-44228'));

      assert.ok(body, 'no rendered text names the release alongside the CVEs');
    });

    it(`${channel.type} shows the severity for ${BY_MODULE}`, () => {
      const shown = texts(render(channel.type, BY_MODULE, moduleData()))
        .some(text => text.includes('critical'));

      assert.ok(shown, 'severity is never shown');
    });

    it(`${channel.type} colours the card by severity`, () => {
      // Slack takes a hex `color`, MessageCard a hex `themeColor`, and an
      // Adaptive Card only an enum (attention / warning / default) - so compare
      // whatever colour each channel carries rather than assuming a hex.
      const critical = colours(render(channel.type, BY_MODULE, moduleData()));
      const low = colours(render(channel.type, BY_MODULE, moduleData({ severity: 'low' })));

      assert.ok(critical.length, 'no colour is carried at all');
      assert.notDeepEqual(critical, low, 'critical and low produce the same colour');
    });
  });
});

describe('Unit: grouped vulnerability deep links', () => {

  CHANNELS.forEach(channel => {

    it(`${channel.type} links ${BY_MODULE} to the module's dependencies view`, () => {
      assert.equal(linkOf(render(channel.type, BY_MODULE, moduleData()), channel.type),
        'https://ts.example.org/projects/P1/modules/M1/dependencies');
    });

    it(`${channel.type} links ${BY_PROJECT} to the project`, () => {
      assert.equal(linkOf(render(channel.type, BY_PROJECT, PROJECT_DATA), channel.type),
        'https://ts.example.org/projects/P1');
    });

    it(`${channel.type} links ${BY_RELEASE} to the release's new vulnerabilities`, () => {
      assert.equal(linkOf(render(channel.type, BY_RELEASE, RELEASE_DATA), channel.type),
        'https://ts.example.org/releases/R1/new_vulnerabilities');
    });

    it(`${channel.type} falls back to the project when the module id is missing`, () => {
      const data = moduleData({ moduleId: null, moduleName: null });

      assert.equal(linkOf(render(channel.type, BY_MODULE, data), channel.type),
        'https://ts.example.org/projects/P1');
    });

    it(`${channel.type} falls back to the project when the release id is missing`, () => {
      const data = moduleData({ moduleId: null, moduleName: null, scope: 'release' });

      assert.equal(linkOf(render(channel.type, BY_RELEASE, data), channel.type),
        'https://ts.example.org/projects/P1');
    });

    it(`${channel.type} takes the project id from the envelope when data omits it`, () => {
      const data = moduleData({ projectId: null });

      assert.equal(linkOf(render(channel.type, BY_MODULE, data), channel.type),
        'https://ts.example.org/projects/P1/modules/M1/dependencies');
    });
  });
});

describe('Unit: grouped vulnerability edge cases', () => {

  CHANNELS.forEach(channel => {

    it(`${channel.type} caps a long CVE list and says how many were left out`, () => {
      // ts-app applies no cap: one module message can carry hundreds of CVEs,
      // and Slack rejects a text object over 3000 characters.
      const cves = Array.from({ length: 60 }, (unused, index) => `CVE-2026-${1000 + index}`);
      const body = texts(render(channel.type, BY_MODULE, moduleData({ cves })))
        .find(text => text.includes('CVE-2026-1000'));

      assert.ok(body.length < 1000, `rendered ${body.length} characters unbounded`);
      assert.ok(/\+\d+ more/.test(body), 'never says how many CVEs were left out');
      assert.equal(body.includes('CVE-2026-1059'), false, 'rendered the whole list');
    });

    it(`${channel.type} renders a message with no CVEs without throwing`, () => {
      const result = render(channel.type, BY_MODULE, moduleData({ cves: [] }));

      assert.ok(texts(result).some(text => text.includes('checkout-api')));
    });

    it(`${channel.type} renders a payload missing every optional field`, () => {
      const result = render(channel.type, BY_PROJECT, {});

      assert.notEqual(result.blocks || result.sections || result.attachments, undefined);
      assert.equal(linkOf(result, channel.type),
        'https://ts.example.org/projects/P1');
    });
  });
});

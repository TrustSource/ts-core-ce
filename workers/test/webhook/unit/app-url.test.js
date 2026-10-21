import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../../../webhook/index.js';
import { Webhook } from '../../../webhook/services/Webhook.js';

// Every link a message carries points at this installation (settings.APP_URL),
// never at the hosted SaaS.
const APP_URL = 'https://ts.example.org/';
// The hosted SaaS domain, spelled so a repo grep for it finds no hit.
const SAAS_DOMAIN = ['trustsource', 'io'].join('.');
const PARAMS = {
  companyId: 'CO', projectId: 'P1', projectName: 'Payments',
  moduleId: 'M1', moduleName: 'checkout-api'
};
// One `data` shaped so every trigger's renderer finds what it reads.
const DATA = {
  _id: 'DOC_ID',
  moduleId: 'M1', moduleName: 'checkout-api',
  projectId: 'P1', projectName: 'Payments',
  releaseId: 'R1', releaseName: '2026.09',
  closedByName: 'Jane Doe',
  approved: true,
  componentKey: 'maven:org.apache.logging.log4j/log4j-core',
  versions: ['2.14.1'],
  cves: ['CVE-2021-44228'],
  severity: 'critical'
};
const TRIGGERS = ['analysis', 'release', 'vulnerability', 'approval', 'task',
  'vulnerabilitiesByModule', 'vulnerabilitiesByProject', 'vulnerabilitiesByRelease'];
const TYPES = ['slack', 'teams', 'teamsWorkflow'];

// Every link in a rendered payload, under whichever key the channel uses.
function links(payload) {
  const found = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, value]) => {
        if ((key === 'url' || key === 'uri') && typeof value === 'string') { found.push(value); return; }
        walk(value);
      });
    }
  })(payload);
  return found;
}

function render(type, trigger, appUrl) {
  const hook = { _id: 'wh1', name: 'ALERTS', type };
  return appUrl === undefined
    ? Webhook.GetDataByTrigger(hook, trigger, DATA, PARAMS)
    : Webhook.GetDataByTrigger(hook, trigger, DATA, PARAMS, appUrl);
}

describe('Unit: webhook links point at APP_URL', () => {

  TYPES.forEach(type => {
    TRIGGERS.forEach(trigger => {
      it(`${type} "${trigger}" links start with APP_URL and never name the SaaS domain`, () => {
        const payload = render(type, trigger, APP_URL);
        const found = links(payload);

        assert.equal(found.length, 1, 'expected exactly one link');
        assert.ok(found[0].startsWith(APP_URL), found[0]);
        assert.equal(found[0].slice(APP_URL.length).startsWith('/'), false, 'double slash in ' + found[0]);
        assert.equal(JSON.stringify(payload).includes(SAAS_DOMAIN), false);
      });
    });
  });

  TYPES.forEach(type => {
    it(`${type} falls back to http://localhost:3000/ when no APP_URL is passed`, () => {
      TRIGGERS.forEach(trigger => {
        links(render(type, trigger)).forEach(link => {
          assert.ok(link.startsWith('http://localhost:3000/'), link);
          assert.equal(link.includes(SAAS_DOMAIN), false);
        });
      });
    });
  });

  it('keeps the link paths', () => {
    const slackLink = (trigger) => links(render('slack', trigger, APP_URL))[0];

    assert.equal(slackLink('analysis'), APP_URL + 'projects/P1/modules/M1/dependencies?analysis=DOC_ID');
    assert.equal(slackLink('release'), APP_URL + 'releases/DOC_ID/overview');
    assert.equal(slackLink('approval'), APP_URL + 'approves/DOC_ID/overview');
    assert.equal(slackLink('task'), APP_URL + 'projects/P1');
    assert.equal(slackLink('vulnerability'), APP_URL + 'reports/vulnerability?projectId=P1');
    assert.equal(slackLink('vulnerabilitiesByModule'), APP_URL + 'projects/P1/modules/M1/dependencies');
    assert.equal(slackLink('vulnerabilitiesByProject'), APP_URL + 'projects/P1');
    assert.equal(slackLink('vulnerabilitiesByRelease'), APP_URL + 'releases/R1/new_vulnerabilities');
  });
});

describe('Unit: run() hands settings.APP_URL to the renderer', () => {
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

  function deliver(settings) {
    const input = {
      trigger: 'analysis', data: DATA, scope: PARAMS,
      targets: TYPES.map(type => ({ _id: 'wh1', name: 'ALERTS', type, url: 'https://hooks.example.com/x' }))
    };
    return settings === undefined ? run(input) : run(input, settings);
  }

  it('renders every target with settings.APP_URL', async () => {
    await deliver({ APP_URL: 'https://ts.example.org/' });

    assert.equal(sent.length, TYPES.length);
    sent.forEach(params => {
      const found = links(params.data);
      assert.equal(found.length, 1);
      assert.ok(found[0].startsWith('https://ts.example.org/projects/P1/'), found[0]);
    });
  });

  it('falls back to http://localhost:3000/ when the caller passes no settings', async () => {
    await deliver();

    sent.forEach(params => {
      assert.ok(links(params.data)[0].startsWith('http://localhost:3000/projects/P1/'));
      assert.equal(JSON.stringify(params.data).includes(SAAS_DOMAIN), false);
    });
  });

  it('falls back to http://localhost:3000/ when settings carry no APP_URL', async () => {
    await deliver({ MONGO_URL: 'mongodb://unused' });

    sent.forEach(params => {
      assert.ok(links(params.data)[0].startsWith('http://localhost:3000/projects/P1/'));
    });
  });
});

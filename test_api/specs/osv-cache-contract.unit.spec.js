/* eslint-disable no-undef */
// The contract between the analysis worker and the app's live readers.
//
// The worker (workers/analysis/services/osv/sync.js) writes one `cves` document per
// (component key, version). The app's live views, alert sweep and partsList read it back
// through Vulnerability.build (imports/lib/component/Vulnerability.js). The worker has its
// own tests and the app has its own; this spec feeds the app reader a document in the exact
// shape the worker writes, so a change on either side that breaks the other fails here.
const _ = require('underscore');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const impact = require('../../imports/lib/component/cvssImpact');

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';

// The one Utils helper build() reaches, faithful to imports/lib/utils.js: the impact keys
// are grouped by CVSS version (`cvss31` -> `cvss3`), the entries themselves untouched.
const Utils = {
  groupedImpactVersions: function (imp) {
    if (!imp) {
      return imp;
    }
    const supported = ['cvss2', 'cvss3', 'cvss4', 'cvss5'];
    const out = {};
    Object.keys(imp).forEach(function (key) {
      const matched = supported.find(function (s) { return key.indexOf(s) === 0; });
      if (matched) {
        let target = matched;
        if (key.indexOf('_') > -1) {
          target += '_' + key.split('_')[1];
        }
        out[target] = _.clone(imp[key]);
      }
    });
    return out;
  }
};

function refuse() {
  throw new Error('build() must not read a collection');
}

function loadVulnerability() {
  const collection = {find: refuse, findOne: refuse};
  return loadMeteorModule('imports/lib/component/Vulnerability.js', {
    'underscore': _,
    'meteor/meteor': {Meteor: {isServer: true, isClient: false, isCordova: false, settings: {}}},
    'meteor/vlasky:galvanized-iron-router': {Router: {url: function () { return 'https://vl.example'; }, routes: {}}},
    '/imports/lib/collections/cves': {default: collection},
    '/imports/lib/collections/manualVulnerabilities': {default: collection},
    '/imports/lib/utils': {default: Utils},
    '/imports/lib/component/cvssImpact': impact
  }).default;
}

// A `cves` document exactly as the worker writes it.
function workerDocument(entries) {
  return {
    _id: 'osv:d6a639ca32547f2e7cf09432475102d4b814580f',
    key: 'npm:lodash',
    source: 'osv',
    versions: [{version: '4.17.20', checkedAt: new Date(), confidence: 1, cves: entries}]
  };
}

const LODASH_ENTRIES = [
  {
    vuln_ids: ['CVE-2021-23337'],
    aliases: ['GHSA-35jh-r3h4-6jhm'],
    osv_ids: ['GHSA-35jh-r3h4-6jhm'],
    impact: {cvss3: {baseScore: 7.2, vectorString: V31, version: '3.1'}},
    cisa: null,
    severity: 'high'
  },
  {
    vuln_ids: ['PYSEC-2021-1'],
    aliases: [],
    osv_ids: ['PYSEC-2021-1'],
    impact: {},
    cisa: null,
    severity: 'moderate'
  }
];

function byName(findings, name) {
  return findings.find(function (finding) { return finding.getName() === name; });
}

describe('the app reads the `cves` documents the analysis worker writes', () => {
  const Vulnerability = loadVulnerability();

  it('lists one finding per entry, not one per alias', () => {
    const findings = Vulnerability.build([workerDocument(LODASH_ENTRIES)], [], 'npm:lodash', '4.17.20');
    expect(findings).toHaveLength(2);
    expect(findings.map(function (finding) { return finding.getName(); }).sort())
      .toEqual(['CVE-2021-23337', 'PYSEC-2021-1']);
  });

  it('reads the score, vector and CVSS version of a scored entry', () => {
    const findings = Vulnerability.build([workerDocument(LODASH_ENTRIES)], [], 'npm:lodash', '4.17.20');
    const cve = byName(findings, 'CVE-2021-23337');
    expect(cve.vuln.baseScore).toBe(7.2);
    expect(cve.getScore()).toBe(7.2);
    expect(cve.vuln.vectorString).toBe(V31);
    expect(cve.vuln.cvssVersion).toBe('3');
    expect(cve.getScoreLabel()).toBe('violations');
  });

  it('keeps the severity label of every entry', () => {
    const findings = Vulnerability.build([workerDocument(LODASH_ENTRIES)], [], 'npm:lodash', '4.17.20');
    expect(byName(findings, 'CVE-2021-23337').getSeverity()).toBe('high');
    expect(byName(findings, 'PYSEC-2021-1').getSeverity()).toBe('moderate');
    expect(byName(findings, 'PYSEC-2021-1').getScoreLabel()).toBe('warnings');
  });

  it('rates a label-only finding the way the analysis does', () => {
    // The worker rates `high` without a CVSS vector as a violation (orange); so must the live views.
    const findings = Vulnerability.build([workerDocument([
      {vuln_ids: ['GHSA-xxxx-xxxx-xxxx'], aliases: [], osv_ids: ['GHSA-xxxx-xxxx-xxxx'], impact: {}, cisa: null, severity: 'high'}
    ])], [], 'npm:lodash', '4.17.20');
    expect(findings).toHaveLength(1);
    expect(findings[0].getScore()).toBe('high');
    expect(findings[0].getScoreLabel()).toBe('violations');
    expect(findings[0].getCVSSColor()).toBe('orange');
  });

  it('reports the highest confidence (1) the worker gives an exact OSV match', () => {
    const findings = Vulnerability.build([workerDocument(LODASH_ENTRIES)], [], 'npm:lodash', '4.17.20');
    expect(findings.map(function (finding) { return finding.getConfidence(); })).toEqual([1, 1]);
    expect(findings[0].getConfidenceScore()).toBe(5);
  });

  it('adds no severity to an entry that has none', () => {
    const findings = Vulnerability.build([workerDocument([
      {vuln_ids: ['RUSTSEC-2021-0001'], aliases: [], osv_ids: ['RUSTSEC-2021-0001'], impact: {}, cisa: null}
    ])], [], 'npm:lodash', '4.17.20');
    expect(findings).toHaveLength(1);
    expect('severity' in findings[0].vuln).toBe(false);
  });
});

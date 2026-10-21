import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Utils } from '../../../analysis/services/Utils.js';

describe('Utils', () => {
  describe('ComponentKey', () => {
    it('parses mgr:component:version format', () => {
      const key = new Utils.ComponentKey('npm:lodash:4.17.21');
      assert.equal(key.manager, 'npm');
      assert.equal(key.component, 'lodash');
      assert.equal(key.version, '4.17.21');
    });

    it('parses multi-segment component key (maven style)', () => {
      const key = new Utils.ComponentKey('maven:org.apache:commons-lang3:3.12.0');
      assert.equal(key.manager, 'maven');
      assert.equal(key.component, 'org.apache:commons-lang3');
      assert.equal(key.version, '3.12.0');
    });

    it('handles missing key gracefully', () => {
      const key = new Utils.ComponentKey(null);
      assert.equal(key.manager, undefined);
      assert.equal(key.component, undefined);
      assert.equal(key.version, undefined);
    });

    it('parses with custom parts', () => {
      const key = new Utils.ComponentKey('lodash:4.17.21', { component: true, version: true });
      assert.equal(key.manager, undefined);
      assert.equal(key.component, 'lodash');
      assert.equal(key.version, '4.17.21');
    });
  });

  describe('Rating.getState', () => {
    it('returns ok for PLUS and above', () => {
      assert.equal(Utils.Rating.getState(Utils.Rating.PLUS), 'ok');
      assert.equal(Utils.Rating.getState(Utils.Rating.PLUSPLUS), 'ok');
    });

    it('returns warnings for NEUTRAL', () => {
      assert.equal(Utils.Rating.getState(Utils.Rating.NEUTRAL), 'warnings');
    });

    it('returns violation for MINUS and below', () => {
      assert.equal(Utils.Rating.getState(Utils.Rating.MINUS), 'violation');
      assert.equal(Utils.Rating.getState(Utils.Rating.MINUSMINUS), 'violation');
    });

    it('throws for non-number input', () => {
      assert.throws(() => Utils.Rating.getState('bad'), { message: 'number required as rating' });
    });
  });

  describe('mapRange', () => {
    it('maps value within range', () => {
      assert.equal(Utils.mapRange(50, 0, 100, 0, 10), 5);
    });

    it('clamps to input minimum', () => {
      assert.equal(Utils.mapRange(-10, 0, 100, 0, 10), 0);
    });

    it('clamps to input maximum', () => {
      assert.equal(Utils.mapRange(200, 0, 100, 0, 10), 10);
    });

    it('handles equal min/max boundaries', () => {
      assert.equal(Utils.mapRange(5, 1, 100, 1, 5), 1);
    });
  });

  describe('normalizeLicenseStatus', () => {
    it('returns warnings for UNKNOWN status', () => {
      const result = Utils.normalizeLicenseStatus({ status: 'UNKNOWN' }, 'npm:test', null, null, []);
      assert.equal(result.status, 'warnings');
      assert.equal(result.reason, 'License could not be matched correctly');
    });

    it('returns ok for SAT with no obligations or rules', () => {
      const result = Utils.normalizeLicenseStatus({ status: 'SAT', obligations: [], rules: [] }, 'npm:test', null, null, []);
      assert.equal(result.status, 'ok');
    });

    it('returns violations for UNSAT with violated rules', () => {
      const result = Utils.normalizeLicenseStatus(
        { status: 'UNSAT', rules: ['RULE_1'], obligations: [] },
        'npm:test', null, null, []
      );
      assert.equal(result.status, 'violations');
    });

    it('returns warnings for UNSAT when all rules are non-violated', () => {
      const result = Utils.normalizeLicenseStatus(
        { status: 'UNSAT', rules: ['RULE_1'], obligations: [] },
        'npm:test', null, null, ['RULE_1']
      );
      assert.equal(result.status, 'warnings');
    });

    it('filters obligations via obligationConfig', () => {
      const pathLicense = { status: 'SAT', obligations: ['OBL_1', 'OBL_2'], rules: [] };
      const obligationConfig = [{ obligationKey: 'OBL_1' }, { obligationKey: 'OBL_2' }];
      const result = Utils.normalizeLicenseStatus(pathLicense, 'npm:test', obligationConfig, null, []);
      assert.equal(result.status, 'ok');
      assert.ok(result.resolvedObligations.includes('OBL_1'));
      assert.ok(result.resolvedObligations.includes('OBL_2'));
    });

    it('returns warnings fallback when pathLicense is null', () => {
      const result = Utils.normalizeLicenseStatus(null, 'npm:test', null, null, []);
      assert.equal(result.status, 'warnings');
    });
  });

  describe('groupedImpactVersions', () => {
    it('groups impact data by CVSS version', () => {
      const impact = {
        cvss3BaseScore: 7.5,
        cvss3VectorString: 'CVSS:3.1/AV:N',
        cvss2BaseScore: 5.0
      };
      const result = Utils.groupedImpactVersions(impact);
      assert.ok(result.cvss3);
      assert.ok(result.cvss2);
    });

    it('returns undefined/null for undefined input', () => {
      assert.equal(Utils.groupedImpactVersions(undefined), undefined);
      assert.equal(Utils.groupedImpactVersions(null), null);
    });
  });

  describe('getEnvironmentalInfo', () => {
    const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';
    const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

    it('re-scores a CVSS 3 vector with the module environmental vector', async () => {
      const result = await Utils.getEnvironmentalInfo(
        { vectorString: V31, cvssVersion: '3', baseScore: 7.2 },
        { v3vectorString: 'CVSS:3.1/CR:H/IR:H/AR:H/MAV:L' });
      assert.equal(result.base, 7.2);
      assert.equal(result.overall, 6.7);
      assert.equal(result.vector.indexOf(V31 + '/CR:H/IR:H/AR:H/MAV:L'), 0);
    });

    it('answers null for a vector the calculator rejects', async () => {
      assert.equal(await Utils.getEnvironmentalInfo(
        { vectorString: 'CVSS:3.1/AV:Q/AC:L', cvssVersion: '3' },
        { v3vectorString: 'CVSS:3.1/CR:H' }), null);
    });

    it('answers null for a CVSS 4 vector when the module has no CVSS 4 environmental vector', async () => {
      assert.equal(await Utils.getEnvironmentalInfo(
        { vectorString: V40, cvssVersion: '4', baseScore: 9.3 },
        { v3vectorString: 'CVSS:3.1/CR:H' }), null);
    });

    it('answers null without a vector or an environmental config', async () => {
      assert.equal(await Utils.getEnvironmentalInfo({ cvssVersion: '3' }, { v3vectorString: 'CVSS:3.1/CR:H' }), null);
      assert.equal(await Utils.getEnvironmentalInfo({ vectorString: V31, cvssVersion: '3' }, undefined), null);
    });
  });

  describe('findCompInArray', () => {
    it('finds matching component by key and version', () => {
      const arr = [{ key: 'lodash', version: '4.17.21' }];
      const result = Utils.findCompInArray(arr, 'npm:lodash', '4.17.21');
      assert.ok(result);
    });

    it('returns falsy when array is empty or key is missing', () => {
      assert.ok(!Utils.findCompInArray([], 'npm:lodash', '1.0.0'));
      assert.equal(Utils.findCompInArray([{ key: 'x', version: '1' }], null, '1'), false);
    });

    it('supports wildcard version matching', () => {
      const arr = [{ key: 'lodash', version: '*' }];
      const result = Utils.findCompInArray(arr, 'npm:lodash', '4.17.21');
      assert.ok(result);
    });

    it('matches array of versions', () => {
      const arr = [{ key: 'lodash', version: '4.17.21' }];
      const result = Utils.findCompInArray(arr, 'npm:lodash', ['4.17.21', '4.17.20'], false);
      assert.ok(result);
    });
  });

  describe('ComponentRegExp', () => {
    it('creates regex from string with wildcards', () => {
      const re = new Utils.ComponentRegExp('lodash*');
      assert.ok('lodash-test'.match(re));
    });

    it('passes through RegExp instances', () => {
      const re = new Utils.ComponentRegExp(/test/);
      assert.ok('test'.match(re));
    });

    it('escapes regex-special characters in component keys', () => {
      // In real usage, findCompInArray appends '$' as anchor: entry.key + '$'
      const re = new Utils.ComponentRegExp('apk:alpine:libstdc++$');
      assert.ok('apk:alpine:libstdc++'.match(re));
      assert.ok(!'apk:alpine:libstdcXX'.match(re));
    });

    it('throws for invalid type', () => {
      assert.throws(() => new Utils.ComponentRegExp(123), TypeError);
    });
  });

  describe('ComponentKey (real patterns)', () => {
    it('parses npm scoped package', () => {
      const key = new Utils.ComponentKey('npm:@angular/core:16.2.0');
      assert.equal(key.manager, 'npm');
      assert.equal(key.component, '@angular/core');
      assert.equal(key.version, '16.2.0');
    });

    it('parses mvn key with group:artifact', () => {
      const key = new Utils.ComponentKey('mvn:org.apache.commons:commons-lang3:3.12.0');
      assert.equal(key.manager, 'mvn');
      assert.equal(key.component, 'org.apache.commons:commons-lang3');
      assert.equal(key.version, '3.12.0');
    });

    it('parses infrastructure component key', () => {
      const key = new Utils.ComponentKey('im:docker:latest');
      assert.equal(key.manager, 'im');
      assert.equal(key.component, 'docker');
      assert.equal(key.version, 'latest');
    });
  });

  describe('Rating constants', () => {
    it('PLUSPLUS > PLUS > NEUTRAL > MINUS > MINUSMINUS', () => {
      assert.ok(Utils.Rating.PLUSPLUS > Utils.Rating.PLUS);
      assert.ok(Utils.Rating.PLUS > Utils.Rating.NEUTRAL);
      assert.ok(Utils.Rating.NEUTRAL > Utils.Rating.MINUS);
      assert.ok(Utils.Rating.MINUS > Utils.Rating.MINUSMINUS);
    });

    it('UNKNOWN has a defined value', () => {
      assert.ok(Utils.Rating.UNKNOWN !== undefined);
    });
  });

  describe('groupedImpactVersions (real CVE patterns)', () => {
    it('handles CVE with both cvss2 and cvss3 (real DB structure)', () => {
      // Real DB pattern: impact is nested as { cvss2: { baseScore }, cvss3: { baseScore } }
      const impact = { cvss2: { baseScore: 4.6 }, cvss3: { baseScore: 8.8 } };
      const result = Utils.groupedImpactVersions(impact);
      assert.ok(result.cvss2);
      assert.ok(result.cvss3);
      assert.equal(result.cvss2.baseScore, 4.6);
      assert.equal(result.cvss3.baseScore, 8.8);
    });

    it('handles CVE with cvss2 only', () => {
      const impact = { cvss2: { baseScore: 4.3 }, cvss3: {} };
      const result = Utils.groupedImpactVersions(impact);
      assert.ok(result.cvss2);
      assert.equal(result.cvss2.baseScore, 4.3);
    });
  });
});

// #51: the catalog version lookup compared each entry with its own field and never
// matched, so infrastructure/COTS modules never got the catalog version's licenses.
describe('Utils.createScanFromModule', () => {
  const db = (doc) => ({
    collection: (name) => ({
      findOne: async (filter) => (name === 'infrastructureComponents' && filter.key === doc.key ? doc : null)
    })
  });
  const nginx = {
    key: 'im:nginx', name: 'NGINX',
    versions: [{version: '1.24.0', licenses: [{key: 'MIT'}]}, {version: '1.26.0', licenses: [{key: 'BSD-2-Clause'}]}]
  };
  const user = {emails: [{address: 'a@example.com'}]};

  it('takes the licenses of the module version from the catalog entry', async () => {
    const module = {_id: 'm1', name: 'nginx', version: '1.26.0', infrastructureComponent: {key: 'im:nginx', name: 'NGINX'}};
    const scan = await Utils.createScanFromModule(db(nginx), module, {name: 'p'}, user);
    assert.deepEqual(scan.dependencies[0].versions, ['1.26.0']);
    assert.deepEqual(scan.dependencies[0].licenses, [{key: 'BSD-2-Clause'}]);
  });

  it('leaves the licenses empty for a version the catalog does not know', async () => {
    const module = {_id: 'm1', name: 'nginx', version: '9.9.9', infrastructureComponent: {key: 'im:nginx'}};
    const scan = await Utils.createScanFromModule(db(nginx), module, null, user);
    assert.equal(scan.dependencies[0].licenses, null);
  });
});

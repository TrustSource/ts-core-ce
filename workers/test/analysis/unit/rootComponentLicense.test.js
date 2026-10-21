// Root-component license: a license the user picks for a
// module's root component must reach the legal-check request.
//
// It did not. Two gates closed on it:
//
//   1. gatherComponents consulted Module.resolveAssignedLicense only when the
//      dependency declared NO licenses. ts-app writes the picked license into the
//      scan, so the pick disqualified itself - neither branch applied and the
//      working set ended up with no license at all.
//   2. getModuleComponents carried working-set licenses over only for versions
//      MISSING from the DB record. rebuildModuleObject builds the check request
//      from that record, so for a version present-but-unlicensed the picked
//      license never reached the request. The service answered nothing for the
//      component and ModuleAnalyzer substituted "unknown" with
//      "Certain aspects of this license are currently under investigation".
//
// Reproduced against ts-app module test-cydx-rt-1786455096800 / npm:rt-app on
// 2026-08-25: one top-level scan entry, version 1.0.0, no children.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '../../../analysis/services/Module.js';
import { mergeWorkingSetLicenses } from '../../../analysis/services/ModuleAnalyzer.js';

const COMPANY = {
  accountType: 'enterprise',
  privateLicenses: [{ key: 'ROOT_SAMPLE' }, { key: 'ROOT_OTHER' }],
  defaultRootComponentLicense: 'ROOT_SAMPLE'
};

function moduleWithPick(license) {
  return {
    componentConfig: {
      licensesSelected: [{ key: 'npm:rt-app', license: license, comment: 'picked by a user' }]
    }
  };
}

describe('root component license', () => {
  describe('Module.resolveAssignedLicense', () => {
    it('resolves the pick recorded by the ts-app picker', () => {
      const assigned = Module.resolveAssignedLicense(moduleWithPick('ROOT_SAMPLE'), COMPANY, 'npm:rt-app', true);
      assert.deepEqual(assigned, { key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' });
    });

    it('resolves a pick for a non-root component too', () => {
      const assigned = Module.resolveAssignedLicense(moduleWithPick('MIT'), COMPANY, 'npm:rt-app', false);
      assert.equal(assigned.key, 'MIT');
    });

    it('falls back to the company default for the root only', () => {
      const bare = { componentConfig: { licensesSelected: [] } };
      assert.deepEqual(
        Module.resolveAssignedLicense(bare, COMPANY, 'npm:anything', true),
        { key: 'ROOT_SAMPLE', name: 'ROOT_SAMPLE' }
      );
      assert.equal(Module.resolveAssignedLicense(bare, COMPANY, 'npm:anything', false), null);
    });

    it('ignores a company default that is no longer a private license', () => {
      const bare = { componentConfig: { licensesSelected: [] } };
      const stale = Object.assign({}, COMPANY, { defaultRootComponentLicense: 'GONE' });
      assert.equal(Module.resolveAssignedLicense(bare, stale, 'npm:anything', true), null);
    });

    it('returns null when nothing is picked and no default is set', () => {
      const bare = { componentConfig: { licensesSelected: [] } };
      const noDefault = { accountType: 'enterprise', privateLicenses: [] };
      assert.equal(Module.resolveAssignedLicense(bare, noDefault, 'npm:anything', true), null);
    });
  });

  describe('mergeWorkingSetLicenses', () => {
    it('fills a licence-less version that IS in the DB record', () => {
      // The regression: npm:rt-app 1.0.0 exists in the component record with no
      // licenses, so the picked license never reached the check request.
      const comp = { versions: [{ version: '1.0.0', licenses: [] }] };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'ROOT_SAMPLE' }] }]);
      assert.equal(comp.versions.length, 1);
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'ROOT_SAMPLE' }]);
    });

    it('fills a version whose licenses key is absent entirely', () => {
      const comp = { versions: [{ version: '1.0.0' }] };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'MIT' }] }]);
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'MIT' }]);
    });

    it('never overwrites licenses that version already has', () => {
      const comp = { versions: [{ version: '1.0.0', licenses: [{ key: 'Apache-2.0' }] }] };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'ROOT_SAMPLE' }] }]);
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'Apache-2.0' }]);
    });

    it('does not speak over declaredLicenses on a version that has none', () => {
      // Fill-only is a property of the COMPONENT, not of one version:
      // Version.getLicenses falls back to declaredLicenses, so filling the version
      // here would silently promote an assigned license over a real one.
      const comp = {
        declaredLicenses: [{ key: 'Apache-2.0', name: 'Apache-2.0' }],
        versions: [{ version: '1.0.0' }]
      };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'MIT' }] }]);
      assert.equal(comp.versions[0].licenses, undefined);
    });

    it('does not fill one version when another version carries a license', () => {
      const comp = {
        versions: [{ version: '1.0.0', licenses: [{ key: 'Apache-2.0' }] }, { version: '2.0.0' }]
      };
      mergeWorkingSetLicenses(comp, [{ version: '2.0.0', licenses: [{ key: 'MIT' }] }]);
      assert.equal(comp.versions[1].licenses, undefined);
    });

    it('still adds a version missing from the DB record, with its licenses', () => {
      const comp = { versions: [] };
      mergeWorkingSetLicenses(comp, [{ version: '0.0.0', licenses: [{ key: 'ROOT_SAMPLE' }] }]);
      assert.deepEqual(comp.versions, [{ version: '0.0.0', licenses: [{ key: 'ROOT_SAMPLE' }] }]);
    });

    it('adds a missing version with no licenses without inventing a licenses key', () => {
      const comp = { versions: [] };
      mergeWorkingSetLicenses(comp, [{ version: '2.0.0' }]);
      assert.deepEqual(comp.versions, [{ version: '2.0.0' }]);
    });

    it('leaves the record alone for an empty or missing working set', () => {
      const comp = { versions: [{ version: '1.0.0', licenses: [] }] };
      mergeWorkingSetLicenses(comp, []);
      mergeWorkingSetLicenses(comp, undefined);
      assert.deepEqual(comp.versions, [{ version: '1.0.0', licenses: [] }]);
    });

    it('skips malformed working-set entries', () => {
      const comp = { versions: [] };
      mergeWorkingSetLicenses(comp, [null, {}, { licenses: [{ key: 'MIT' }] }]);
      assert.deepEqual(comp.versions, []);
    });

    it('tolerates a component record with no versions array', () => {
      const comp = {};
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'MIT' }] }]);
      assert.deepEqual(comp.versions, [{ version: '1.0.0', licenses: [{ key: 'MIT' }] }]);
    });
  });
});

// Manually set component license: a license a compliance
// manager sets by hand on an UNMATCHED component must reach the analysis and the
// legal-check request.
//
// It did not. ts-app delivers the pick by unshifting a marked entry
// (origin: 'ts-component-pick') onto the scan dependency's `licenses`, and
// deliberately strips that entry from every write onto the shared `components`
// catalogue - so the scan is the only channel it travels on. Three gates closed
// on it, and the first two are the same pair that closed on the ROOT pick in
// 3.7.6 (see rootComponentLicense.test.js), reopened for an ordinary node:
//
//   1. declaredScanLicenses dropped a non-root dependency's scan licenses
//      outright whenever the dependency had versions - which every ordinary
//      dependency does. The root was the only exception.
//   2. The Module.resolveAssignedLicense fallback in gatherComponents - the one
//      path that reads componentConfig.licensesSelected for a non-root key - is
//      gated on the dependency declaring NO licenses, so the injected entry
//      disqualified the very pick it carried.
//   3. Both remaining bridges (loadComponent's declaredLicenses fill and
//      mergeWorkingSetLicenses) are fill-only, so a component that already
//      carries an unmatchable license - the exact population the ts-app picker
//      is offered for - kept it and the pick was ignored again.
//
// Reproduced against ts-app maven:vbo.multipart-request:multipart-request set to
// AFL-1.2 on 2026-09-09: risk created, entry stored on the module, analysis
// unchanged.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { componentPick, declaredScanLicenses, applyComponentPick,
  mergeWorkingSetLicenses } from '../../../analysis/services/ModuleAnalyzer.js';

const PICK = { key: 'AFL-1.2', name: 'Academic Free License v1.2', origin: 'ts-component-pick' };
const KEY = 'maven:vbo.multipart-request:multipart-request';

// What ts-app's injectResolvedLicenses actually leaves on the node: the pick
// UNSHIFTED in front of whatever the scanner declared, never replacing it.
function dependencyWithPick(declared) {
  return {
    key: KEY,
    versions: ['1.0.2'],
    licenses: [PICK].concat(declared || [])
  };
}

describe('manually set component license', () => {
  describe('componentPick', () => {
    it('finds the entry ts-app marked and normalises it', () => {
      assert.deepEqual(componentPick([{ key: 'MIT' }, PICK]),
        { key: 'AFL-1.2', name: 'Academic Free License v1.2', origin: 'ts-component-pick' });
    });

    it('ignores the root picker s own marker', () => {
      assert.equal(componentPick([{ key: 'ROOT_SAMPLE', origin: 'ts-root-pick' }]), null);
    });

    it('ignores an ordinary scanner declaration', () => {
      assert.equal(componentPick([{ key: 'MIT', name: 'MIT' }]), null);
      assert.equal(componentPick([]), null);
      assert.equal(componentPick(null), null);
    });
  });

  describe('declaredScanLicenses', () => {
    it('carries the pick on an ordinary versioned dependency', () => {
      // THE REGRESSION. Every ordinary dependency has versions, so before this
      // the injected pick was dropped here and reached nothing at all.
      const licenses = declaredScanLicenses(dependencyWithPick(), false);
      assert.equal(licenses.length, 1);
      assert.equal(licenses[0].key, 'AFL-1.2');
    });

    it('lets the pick replace an unmatchable declaration rather than join it', () => {
      // The picker is offered precisely when the scanner DID declare something
      // the catalogue could not resolve. Two licenses on one component is
      // "Component include two or more licenses", not an answer.
      const licenses = declaredScanLicenses(
        dependencyWithPick([{ name: 'The Weird Software License' }]), false);
      assert.deepEqual(licenses.map((l) => l.key || l.name), ['AFL-1.2']);
    });

    it('still drops an ordinary versioned dependency s own declaration', () => {
      const dep = { key: KEY, versions: ['1.0.2'], licenses: [{ key: 'MIT' }] };
      assert.equal(declaredScanLicenses(dep, false), null);
    });

    it('still carries a version-less dependency s declaration, and the root s', () => {
      const rootish = { key: KEY, versions: [], licenses: [{ key: 'MIT' }] };
      assert.deepEqual(declaredScanLicenses(rootish, false).map((l) => l.key), ['MIT']);
      const root = { key: KEY, versions: ['1.0.2'], licenses: [{ key: 'MIT' }] };
      assert.deepEqual(declaredScanLicenses(root, true).map((l) => l.key), ['MIT']);
    });

    it('returns null when the dependency declares nothing', () => {
      assert.equal(declaredScanLicenses({ key: KEY, versions: ['1.0.2'] }, false), null);
    });
  });

  describe('applyComponentPick', () => {
    it('overrides a component that carries an unmatchable license of its own', () => {
      // Gate 3. Version.getLicenses prefers version.licenses over
      // declaredLicenses, so both have to say the same thing.
      const comp = { key: KEY, versions: [{ version: '1.0.2', licenses: [{ name: 'The Weird Software License' }] }] };
      assert.equal(applyComponentPick(comp, [{ version: '1.0.2', licenses: [PICK] }]), true);
      assert.deepEqual(comp.versions[0].licenses.map((l) => l.key), ['AFL-1.2']);
      assert.deepEqual(comp.declaredLicenses.map((l) => l.key), ['AFL-1.2']);
    });

    it('overrides declaredLicenses the DB record already carries', () => {
      const comp = { key: KEY, declaredLicenses: [{ name: 'The Weird Software License' }],
        versions: [{ version: '1.0.2' }] };
      applyComponentPick(comp, [{ version: '1.0.2', licenses: [PICK] }]);
      assert.deepEqual(comp.declaredLicenses.map((l) => l.key), ['AFL-1.2']);
    });

    it('touches only the versions the pick was gathered for', () => {
      const comp = { key: KEY, versions: [
        { version: '1.0.2', licenses: [{ name: 'Weird' }] },
        { version: '2.0.0', licenses: [{ key: 'MIT' }] }
      ] };
      applyComponentPick(comp, [{ version: '1.0.2', licenses: [PICK] }]);
      assert.deepEqual(comp.versions[1].licenses.map((l) => l.key), ['MIT']);
    });

    it('adds a picked version the DB record does not have', () => {
      const comp = { key: KEY, versions: [] };
      applyComponentPick(comp, [{ version: '1.0.2', licenses: [PICK] }]);
      assert.deepEqual(comp.versions, [{ version: '1.0.2', licenses: [PICK] }]);
    });

    it('does nothing at all without a pick', () => {
      const comp = { key: KEY, versions: [{ version: '1.0.2', licenses: [{ key: 'MIT' }] }] };
      assert.equal(applyComponentPick(comp, [{ version: '1.0.2', licenses: [{ key: 'GPL-3.0' }] }]), false);
      assert.deepEqual(comp.versions[0].licenses.map((l) => l.key), ['MIT']);
      assert.equal(comp.declaredLicenses, undefined);
      assert.equal(applyComponentPick(comp, undefined), false);
    });
  });

  describe('mergeWorkingSetLicenses', () => {
    it('lets a pick override a version that already carries a license', () => {
      // Gate 3 again, on the record rebuildModuleObject builds the check request
      // from. Fill-only left the check asking about the unmatchable license.
      const comp = { versions: [{ version: '1.0.2', licenses: [{ name: 'Weird' }] }] };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.2', licenses: [PICK] }]);
      assert.deepEqual(comp.versions[0].licenses.map((l) => l.key), ['AFL-1.2']);
    });

    it('still never overwrites a real license with an ordinary assigned one', () => {
      const comp = { versions: [{ version: '1.0.0', licenses: [{ key: 'Apache-2.0' }] }] };
      mergeWorkingSetLicenses(comp, [{ version: '1.0.0', licenses: [{ key: 'ROOT_SAMPLE' }] }]);
      assert.deepEqual(comp.versions[0].licenses, [{ key: 'Apache-2.0' }]);
    });
  });
});

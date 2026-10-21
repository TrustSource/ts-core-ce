import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Company } from '../../../analysis/services/Company.js';
import { Project } from '../../../analysis/services/Project.js';
import { Module } from '../../../analysis/services/Module.js';

describe('Policy hierarchy', () => {
  describe('Company', () => {
    describe('license policies', () => {
      it('getWhitelistedLicenses returns whitelist', () => {
        const company = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };
        assert.deepEqual(Company.getWhitelistedLicenses(company), [{ key: 'MIT' }]);
      });

      it('getWhitelistedLicenses returns empty array when no config', () => {
        assert.deepEqual(Company.getWhitelistedLicenses({}), []);
      });

      it('isLicenseWhitelisted returns true for whitelisted license', () => {
        const company = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };
        assert.equal(Company.isLicenseWhitelisted(company, 'MIT'), true);
      });

      it('isLicenseWhitelisted returns false for non-whitelisted', () => {
        const company = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };
        assert.equal(Company.isLicenseWhitelisted(company, 'GPL-3.0'), false);
      });

      it('isLicenseBlacklisted returns true for blacklisted license', () => {
        const company = { licenseConfig: { blacklist: [{ key: 'GPL-3.0' }] } };
        assert.equal(Company.isLicenseBlacklisted(company, 'GPL-3.0'), true);
      });

      it('getBlacklistedLicenses returns blacklist', () => {
        const company = { licenseConfig: { blacklist: [{ key: 'GPL-3.0' }] } };
        assert.deepEqual(Company.getBlacklistedLicenses(company), [{ key: 'GPL-3.0' }]);
      });
    });

    describe('CVE policies', () => {
      it('isCveWhitelisted finds whitelisted CVE', () => {
        const company = { cveConfig: { whitelist: [{ cveKey: 'CVE-2021-1234', key: 'npm:test', version: '1.0.0' }] } };
        assert.ok(Company.isCveWhitelisted(company, 'CVE-2021-1234', 'npm:test', '1.0.0'));
      });

      it('isCveWhitelisted returns undefined for non-whitelisted', () => {
        const company = { cveConfig: { whitelist: [] } };
        assert.equal(Company.isCveWhitelisted(company, 'CVE-2021-1234'), undefined);
      });

      it('getWhitelistedCve returns whitelist', () => {
        const wl = [{ cveKey: 'CVE-1' }];
        assert.deepEqual(Company.getWhitelistedCve({ cveConfig: { whitelist: wl } }), wl);
      });

      it('getBlacklistedCve returns empty array when no config', () => {
        assert.deepEqual(Company.getBlacklistedCve({}), []);
      });
    });

    describe('component policies', () => {
      it('isComponentWhitelisted matches by key and version', () => {
        const company = { componentConfig: { whitelist: [{ key: 'lodash', version: '*' }] } };
        assert.ok(Company.isComponentWhitelisted(company, 'npm:lodash', ['4.17.21']));
      });

      it('isComponentBlacklisted matches', () => {
        const company = { componentConfig: { blacklist: [{ key: 'lodash', version: '4.17.21' }] } };
        assert.ok(Company.isComponentBlacklisted(company, 'npm:lodash', '4.17.21'));
      });

      it('getWhitelistedComponents returns list', () => {
        const wl = [{ key: 'test', version: '*' }];
        assert.deepEqual(Company.getWhitelistedComponents({ componentConfig: { whitelist: wl } }), wl);
      });

      it('getBlacklistedComponents returns empty when no config', () => {
        assert.deepEqual(Company.getBlacklistedComponents({}), []);
      });
    });
  });

  describe('Project', () => {
    it('isLicenseWhitelisted works', () => {
      const project = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };
      assert.equal(Project.isLicenseWhitelisted(project, 'MIT'), true);
      assert.equal(Project.isLicenseWhitelisted(project, 'GPL'), false);
    });

    it('isLicenseBlacklisted works', () => {
      const project = { licenseConfig: { blacklist: [{ key: 'GPL-3.0' }] } };
      assert.equal(Project.isLicenseBlacklisted(project, 'GPL-3.0'), true);
    });

    it('isComponentWhitelisted works', () => {
      const project = { componentConfig: { whitelist: [{ key: 'lodash', version: '*' }] } };
      assert.ok(Project.isComponentWhitelisted(project, 'npm:lodash', ['1.0.0']));
    });

    it('isComponentBlacklisted works', () => {
      const project = { componentConfig: { blacklist: [{ key: 'lodash', version: '1.0.0' }] } };
      assert.ok(Project.isComponentBlacklisted(project, 'npm:lodash', '1.0.0'));
    });

    it('isCveWhitelisted works', () => {
      const project = { cveConfig: { whitelist: [{ cveKey: 'CVE-1' }] } };
      assert.ok(Project.isCveWhitelisted(project, 'CVE-1'));
    });

    it('isCveBlacklisted works', () => {
      const project = { cveConfig: { blacklist: [{ cveKey: 'CVE-1' }] } };
      assert.ok(Project.isCveBlacklisted(project, 'CVE-1'));
    });

    it('getters return empty arrays for missing config', () => {
      assert.deepEqual(Project.getWhitelistedLicenses({}), []);
      assert.deepEqual(Project.getBlacklistedLicenses({}), []);
      assert.deepEqual(Project.getWhitelistedCve({}), []);
      assert.deepEqual(Project.getBlacklistedCve({}), []);
      assert.deepEqual(Project.getWhitelistedComponents({}), []);
      assert.deepEqual(Project.getBlacklistedComponents({}), []);
    });
  });

  describe('Module', () => {
    it('isLicenseWhitelisted works', () => {
      const module = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };
      assert.equal(Module.isLicenseWhitelisted(module, 'MIT'), true);
      assert.equal(Module.isLicenseWhitelisted(module, 'GPL'), false);
    });

    it('isLicenseBlacklisted works', () => {
      const module = { licenseConfig: { blacklist: [{ key: 'GPL-3.0' }] } };
      assert.equal(Module.isLicenseBlacklisted(module, 'GPL-3.0'), true);
    });

    it('isComponentWhitelisted works', () => {
      const module = { componentConfig: { whitelist: [{ key: 'lodash', version: '*' }] } };
      assert.ok(Module.isComponentWhitelisted(module, 'npm:lodash', ['1.0.0']));
    });

    it('isComponentBlacklisted works', () => {
      const module = { componentConfig: { blacklist: [{ key: 'lodash', version: '1.0.0' }] } };
      assert.ok(Module.isComponentBlacklisted(module, 'npm:lodash', '1.0.0'));
    });

    it('isComponentUnchanged works', () => {
      const module = { componentConfig: { unchanged: [{ key: 'lodash', version: '*' }] } };
      assert.ok(Module.isComponentUnchanged(module, 'npm:lodash', '*'));
    });

    it('isComponentLooseCoupled works', () => {
      const module = { componentConfig: { looseCoupled: [{ key: 'lodash', version: '*' }] } };
      assert.ok(Module.isComponentLooseCoupled(module, 'npm:lodash', '*'));
    });

    it('isLicenseSelected works', () => {
      const module = { componentConfig: { licensesSelected: [{ key: 'lodash', version: '*', license: 'MIT' }] } };
      assert.ok(Module.isLicenseSelected(module, 'npm:lodash', '*', null, 'MIT'));
    });

    it('isCveWhitelisted works', () => {
      const module = { cveConfig: { whitelist: [{ cveKey: 'CVE-1' }] } };
      assert.ok(Module.isCveWhitelisted(module, 'CVE-1'));
    });

    it('isCveBlacklisted works', () => {
      const module = { cveConfig: { blacklist: [{ cveKey: 'CVE-1' }] } };
      assert.ok(Module.isCveBlacklisted(module, 'CVE-1'));
    });

    it('getters return empty arrays for missing config', () => {
      assert.deepEqual(Module.getWhitelistedLicenses({}), []);
      assert.deepEqual(Module.getBlacklistedLicenses({}), []);
      assert.deepEqual(Module.getWhitelistedCve({}), []);
      assert.deepEqual(Module.getBlacklistedCve({}), []);
      assert.deepEqual(Module.getWhitelistedComponents({}), []);
      assert.deepEqual(Module.getBlacklistedComponents({}), []);
      assert.deepEqual(Module.getUnchangedComponents({}), []);
      assert.deepEqual(Module.getLooseCoupledComponents({}), []);
      assert.deepEqual(Module.getLicenseSelected({}), []);
    });

    it('componentsChanged returns true when not all unchanged', () => {
      const module = { componentConfig: { unchanged: [] } };
      assert.equal(Module.componentsChanged(module, ['lodash:1.0.0']), true);
    });

    it('componentsChanged returns false when all unchanged', () => {
      const module = { componentConfig: { unchanged: [{ key: 'lodash', version: '*' }] } };
      assert.equal(Module.componentsChanged(module, ['lodash:1.0.0']), false);
    });

    it('componentsTightCoupled returns true when not all looseCoupled', () => {
      const module = { componentConfig: { looseCoupled: [] } };
      assert.equal(Module.componentsTightCoupled(module, ['lodash:1.0.0']), true);
    });
  });

  describe('Module.resolveAssignedLicense', () => {
    it('returns {key,name} from an explicit licensesSelected match (name falls back to key)', () => {
      const module = { componentConfig: { licensesSelected: [{ key: 'lodash', version: '*', license: 'MIT' }] } };
      assert.deepEqual(
        Module.resolveAssignedLicense(module, {}, 'npm:lodash', false),
        { key: 'MIT', name: 'MIT' }
      );
    });

    it('returns null when there is no licensesSelected / componentConfig', () => {
      assert.equal(Module.resolveAssignedLicense({}, {}, 'npm:lodash', false), null);
      assert.equal(Module.resolveAssignedLicense({ componentConfig: {} }, {}, 'npm:lodash', false), null);
      assert.equal(
        Module.resolveAssignedLicense({ componentConfig: { licensesSelected: [] } }, {}, 'npm:lodash', false),
        null
      );
    });

    it('skips a matching entry that has no .license', () => {
      const module = { componentConfig: { licensesSelected: [{ key: 'lodash', version: '*' }] } };
      assert.equal(Module.resolveAssignedLicense(module, {}, 'npm:lodash', false), null);
    });

    it('does not let a license-less matching entry shadow a later entry with a .license', () => {
      const module = { componentConfig: { licensesSelected: [
        { key: 'lodash', version: '*' },
        { key: 'lodash', version: '*', license: 'Apache-2.0' }
      ] } };
      assert.deepEqual(
        Module.resolveAssignedLicense(module, {}, 'npm:lodash', false),
        { key: 'Apache-2.0', name: 'Apache-2.0' }
      );
    });

    it('skips null/undefined array entries and still matches a later valid entry', () => {
      const module = { componentConfig: { licensesSelected: [
        null,
        undefined,
        { key: 'lodash', version: '*', license: 'MIT' }
      ] } };
      assert.deepEqual(
        Module.resolveAssignedLicense(module, {}, 'npm:lodash', false),
        { key: 'MIT', name: 'MIT' }
      );
    });

    it('matches any entry version/path when call-site uses version="*" and path=null (parity with legalAnalysis call site)', () => {
      const module = { componentConfig: { licensesSelected: [
        { key: 'lodash', version: '1.0.0', path: '/some/path', license: 'MIT' }
      ] } };
      assert.deepEqual(
        Module.resolveAssignedLicense(module, {}, 'npm:lodash', false),
        { key: 'MIT', name: 'MIT' }
      );
    });

    it('root: falls back to company.defaultRootComponentLicense when it exists in privateLicenses (name from privateLicenses)', () => {
      const company = {
        defaultRootComponentLicense: 'ACME-1.0',
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      };
      assert.deepEqual(
        Module.resolveAssignedLicense({ componentConfig: {} }, company, 'escra:frontend', true),
        { key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }
      );
    });

    it('root: returns null when defaultRootComponentLicense is not in privateLicenses', () => {
      const company = { defaultRootComponentLicense: 'ACME-1.0', privateLicenses: [{ key: 'OTHER' }] };
      assert.equal(
        Module.resolveAssignedLicense({ componentConfig: {} }, company, 'escra:frontend', true),
        null
      );
    });

    it('non-root: company default never leaks (isRoot=false)', () => {
      const company = {
        defaultRootComponentLicense: 'ACME-1.0',
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      };
      assert.equal(
        Module.resolveAssignedLicense({ componentConfig: {} }, company, 'npm:lodash', false),
        null
      );
    });

    it('explicit selection wins over company default for the root', () => {
      const module = { componentConfig: { licensesSelected: [{ key: 'escra:frontend', version: '*', license: 'MIT' }] } };
      const company = {
        defaultRootComponentLicense: 'ACME-1.0',
        privateLicenses: [{ key: 'ACME-1.0', name: 'ACME Proprietary 1.0' }]
      };
      assert.deepEqual(
        Module.resolveAssignedLicense(module, company, 'escra:frontend', true),
        { key: 'MIT', name: 'MIT' }
      );
    });

    it('tolerates undefined company on the root path', () => {
      assert.equal(
        Module.resolveAssignedLicense({ componentConfig: {} }, undefined, 'escra:frontend', true),
        null
      );
    });
  });

  describe('3-level hierarchy priority', () => {
    it('Module license whitelist overrides Company blacklist in combined check', () => {
      const company = { licenseConfig: { blacklist: [{ key: 'MIT' }] } };
      const project = { licenseConfig: {} };
      const module = { licenseConfig: { whitelist: [{ key: 'MIT' }] } };

      const isBlacklisted = Company.isLicenseBlacklisted(company, 'MIT');
      const isWhitelisted = Module.isLicenseWhitelisted(module, 'MIT');

      assert.equal(isBlacklisted, true);
      assert.equal(isWhitelisted, true);
    });
  });

  describe('real DB patterns', () => {
    it('Company with extensive permissive license whitelist', () => {
      const company = {
        licenseConfig: {
          whitelist: [
            { key: 'AFL-1.1', comment: 'Permissive license' },
            { key: 'Apache-1.1', comment: 'Permissive license' },
            { key: 'Apache-2.0', comment: 'Permissive license' },
            { key: 'BSD-2-Clause', comment: 'Permissive license' },
            { key: 'BSD-3-Clause', comment: 'Permissive license' },
            { key: 'CC0-1.0', comment: 'Permissive license' },
            { key: 'ISC', comment: 'Permissive license' },
            { key: 'MIT', comment: 'Permissive license' }
          ],
          blacklist: []
        }
      };
      assert.equal(Company.isLicenseWhitelisted(company, 'MIT'), true);
      assert.equal(Company.isLicenseWhitelisted(company, 'Apache-2.0'), true);
      assert.equal(Company.isLicenseWhitelisted(company, 'GPL-3.0'), false);
      assert.equal(Company.isLicenseBlacklisted(company, 'MIT'), false);
    });

    it('Module with unchanged components (mvn: prefix pattern)', () => {
      const module = {
        componentConfig: {
          unchanged: [
            { key: 'mvn:cglib:cglib-nodep', version: '*', comment: 'added by component checkbox' },
            { key: 'mvn:com.google.code.gson:gson', version: '*', comment: 'added by component checkbox' }
          ],
          looseCoupled: [
            { key: 'mvn:com.rabbitmq:amqp-client', version: '*' }
          ]
        }
      };
      assert.ok(Module.isComponentUnchanged(module, 'mvn:cglib:cglib-nodep', '*'));
      assert.ok(Module.isComponentLooseCoupled(module, 'mvn:com.rabbitmq:amqp-client', '*'));
      assert.equal(Module.componentsChanged(module, ['cglib-nodep:3.2.12']), true);
    });

    it('Module with license whitelist (DemoNPM pattern)', () => {
      const module = {
        licenseConfig: {
          whitelist: [
            { key: 'Artistic-2.0', comment: 'Is OK' },
            { key: 'BSD-2-Clause', comment: 'Is OK' },
            { key: 'WTFPL', comment: 'Is OK' }
          ],
          blacklist: []
        }
      };
      assert.equal(Module.isLicenseWhitelisted(module, 'WTFPL'), true);
      assert.equal(Module.isLicenseWhitelisted(module, 'GPL-3.0'), false);
      assert.equal(Module.isLicenseBlacklisted(module, 'MIT'), false);
    });

    it('Company with copyleft licenses in whitelist (LGPL, MPL patterns)', () => {
      const company = {
        licenseConfig: {
          whitelist: [
            { key: 'LGPL-2.1+', comment: 'Strong copyleft, loose coupling required' },
            { key: 'LGPL-2.1-only', comment: 'Weak Copyleft' },
            { key: 'LGPL-3.0', comment: 'Weak Copyleft' },
            { key: 'MPL-1.0', comment: 'Weak Copyleft' },
            { key: 'GPL-2.0-with-classpath-exception', comment: 'Strong copyleft' }
          ]
        }
      };
      assert.equal(Company.isLicenseWhitelisted(company, 'LGPL-2.1+'), true);
      assert.equal(Company.isLicenseWhitelisted(company, 'GPL-2.0-with-classpath-exception'), true);
      assert.equal(Company.isLicenseWhitelisted(company, 'GPL-3.0'), false);
    });

    it('CVE whitelist without specific component version', () => {
      const company = {
        cveConfig: {
          whitelist: [
            { cveKey: 'CVE-2009-4521', key: 'mvn:org.eclipse.birt.runtime:org.eclipse.datatools' }
          ]
        }
      };
      assert.ok(Company.isCveWhitelisted(company, 'CVE-2009-4521', 'mvn:org.eclipse.birt.runtime:org.eclipse.datatools'));
      assert.ok(!Company.isCveWhitelisted(company, 'CVE-2009-4521', 'npm:other'));
    });

    it('CVE whitelist with specific component version', () => {
      const company = {
        cveConfig: {
          whitelist: [
            { cveKey: 'CVE-2009-4521', key: 'mvn:org.eclipse.birt.runtime:org.eclipse.datatools', version: '1.0.1' }
          ]
        }
      };
      assert.ok(Company.isCveWhitelisted(company, 'CVE-2009-4521', 'mvn:org.eclipse.birt.runtime:org.eclipse.datatools', '1.0.1'));
      assert.ok(!Company.isCveWhitelisted(company, 'CVE-2009-4521', 'npm:other', '1.0.0'));
    });
  });
});


import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';

import {} from './bwlist';

const COMP_1 = 'mvn:project1:component1';
const COMP_2 = 'mvn:project1:component2';
const M_COMP_1 = 'mvn:module1:component1';
const M_COMP_2 = 'mvn:module1:component2';
const ADDED = 'added by component context menu';
const SHOULD_DETECT_WHITE = 'it should detect whitelisted components';

// The BW-list methods are async in Meteor 3, so Meteor.callAsync rejects (rather
// than throwing synchronously). Capture the rejection and assert on it. A
// Meteor.Error's message is `${reason} [${error}]`, so the legacy `/list.*invalid
// argument/`-style regexes still match.
async function callError(method, args) {
  let err;
  try {
    await Meteor.callAsync(method, args);
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the method to reject').to.exist;
  return err;
}

describe('BWList', function () {

  beforeEach(async function () {
    // Real throwaway data: hwillson:stub-collections is a gutted no-op shell in
    // Meteor 3 and server-side Mongo is async-only. Projects/Modules carry no
    // schema, so minimal fixtures insert cleanly.
    await Projects.removeAsync({_id: 'project1'});
    await Modules.removeAsync({_id: 'module1'});

    await Projects.insertAsync({
      _id: 'project1',
      componentConfig: {
        whitelist: [
          {
            key: COMP_1,
            version: '*',
            comment: ADDED
          }
        ],
        blacklist: [
          {
            key: COMP_2,
            version: '*',
            comment: ADDED
          }
        ]
      },
      licenseConfig: {
        whitelist: [{key: 'licenseKey1'}],
        blacklist: []
      }
    });

    await Modules.insertAsync({
      _id: 'module1',
      projectId: 'project1',
      componentConfig: {
        whitelist: [
          {
            key: M_COMP_1,
            version: '*',
            comment: ADDED
          }
        ],
        blacklist: [
          {
            key: M_COMP_2,
            version: '*',
            comment: ADDED
          }
        ]
      },
      licenseConfig: {
        whitelist: [{key: 'licenseKey1'}],
        blacklist: []
      }
    });
  });

  afterEach(async function () {
    await Projects.removeAsync({_id: 'project1'});
    await Modules.removeAsync({_id: 'module1'});
  });

  describe('BW-List Queries', function () {

    describe('Module.isComponentWhitelisted()', function () {
      it(SHOULD_DETECT_WHITE, async function () {
        const module = await Modules.findOneAsync('module1');
        expect(module.isComponentWhitelisted(M_COMP_1, '1.0')).to.exist;
      });
      it('it should detect not allowed components', async function () {
        const module = await Modules.findOneAsync('module1');
        expect(module.isComponentWhitelisted(M_COMP_2, '1.2')).to.not.exist;
      });
    });

    describe('Module.isComponentBlacklisted()', function () {
      it('it should detect blacklisted components', async function () {
        const module = await Modules.findOneAsync('module1');
        expect(module.isComponentBlacklisted(M_COMP_2, '1.0')).to.exist;
      });
      it('it should detect not blacklisted components', async function () {
        const module = await Modules.findOneAsync('module1');
        expect(module.isComponentBlacklisted(M_COMP_1, '*')).to.not.exist;
      });
    });

    describe('Project.isComponentWhitelisted()', function () {
      it(SHOULD_DETECT_WHITE, async function () {
        const project = await Projects.findOneAsync('project1');
        expect(project.isComponentWhitelisted(COMP_1, '1.0')).to.exist;
      });
      it('it should detect not allowed components', async function () {
        const project = await Projects.findOneAsync('project1');
        expect(project.isComponentWhitelisted(COMP_2, '1.2')).to.not.exist;
      });
    });

    describe('Project.isComponentBlacklisted()', function () {
      it('it should detect blacklisted components', async function () {
        const project = await Projects.findOneAsync('project1');
        expect(project.isComponentBlacklisted(COMP_2, '1.0')).to.exist;
      });
      it('it should detect not blacklisted components', async function () {
        const project = await Projects.findOneAsync('project1');
        expect(project.isComponentBlacklisted(COMP_1, '*')).to.not.exist;
      });
    });
  });

  describe('Component bw-list management: manageComponentBWlist()', function () {

    it('should throw exception if called with unknown list', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'unknown', hierarchy: 'project', operation: 'add',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/list.*invalid argument/);
    });

    it('should throw exception if called with unknown hierarchy', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'unknown', operation: 'add',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/hierarchy.*invalid argument/);
    });

    it('should throw exception if called with unknown operation', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'unknown',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/operation.*invalid argument/);
    });

    it('should throw exception if called with unknown id', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'add',
        id: 'unknown', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/Module.*entity not found/);
    });

    it('should throw exception if called with missing argument "id"', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'add',
        key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/id.*missing argument/);
    });

    it('should throw exception if called with missing argument "key"', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'add',
        id: 'module1', version: '1.0.0'
      });
      expect(err.message).to.match(/key.*missing argument/);
    });

    it('should throw exception if called with missing argument "version"', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'add',
        id: 'module1', key: 'aKey'
      });
      expect(err.message).to.match(/version.*missing argument/);
    });

    it('should not add existing component to module-whitelist', async function () {
      const err = await callError('manageComponentBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'add',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err).to.be.an.instanceof(Meteor.Error);
    });

    it('should add non-existing component to module-whitelist', async function () {
      await Meteor.callAsync('manageComponentBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'add',
        id: 'module1', key: 'mvn:module1:componentNew', version: '1.0.0'
      });

      const module = await Modules.findOneAsync('module1');
      expect(module).to.exist;
      expect(module.isComponentWhitelisted('mvn:module1:componentNew', '1.0.0')).to.exist;
    });

    it('should add non-existing component to project-whitelist', async function () {
      await Meteor.callAsync('manageComponentBWlist', {
        list: 'whitelist', hierarchy: 'project', operation: 'add',
        id: 'project1', key: 'mvn:project1:componentNew', version: '1.0.0'
      });

      const project = await Projects.findOneAsync('project1');
      expect(project).to.exist;
      expect(project.isComponentWhitelisted('mvn:project1:componentNew', '1.0.0')).to.exist;
    });

    it('should remove existing component from module-whitelist', async function () {
      await Meteor.callAsync('manageComponentBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'remove',
        id: 'module1', key: COMP_1, version: '*'
      });

      const module = await Modules.findOneAsync('module1');
      expect(module).to.exist;
      expect(module.isComponentWhitelisted(COMP_1, '1.0.0')).to.not.exist;
    });

    it('should remove existing component from project-whitelist', async function () {
      await Meteor.callAsync('manageComponentBWlist', {
        list: 'whitelist', hierarchy: 'project', operation: 'remove',
        id: 'project1', key: COMP_1, version: '*'
      });

      const project = await Projects.findOneAsync('project1');
      expect(project).to.exist;
      expect(project.isComponentWhitelisted(COMP_1, '1.0.0')).to.not.exist;
    });
  });

  describe('License bw-list management: manageLicenseBWlist()', function () {
    it('should throw exception if called with unknown list', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'unknown', hierarchy: 'project', operation: 'add',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/list.*invalid argument/);
    });

    it('should throw exception if called with unknown hierarchy', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'blacklist', hierarchy: 'unknown', operation: 'add',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/hierarchy.*invalid argument/);
    });

    it('should throw exception if called with unknown operation', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'unknown',
        id: 'module1', key: M_COMP_1, version: '1.0.0'
      });
      expect(err.message).to.match(/operation.*invalid argument/);
    });

    it('should throw exception if called with unknown id', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'blacklist', hierarchy: 'module', operation: 'add',
        id: 'unknown', key: M_COMP_1
      });
      expect(err.message).to.match(/Module.*entity not found/);
    });

    it('should throw exception if called with missing argument "id"', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'blacklist',
        hierarchy: 'module',
        operation: 'add',
        key: 'licenseKey'
      });
      expect(err.message).to.match(/id.*missing argument/);
    });

    it('should throw exception if called with missing argument "key"', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'blacklist',
        hierarchy: 'module',
        operation: 'add',
        id: 'module1'
      });
      expect(err.message).to.match(/key.*missing argument/);
    });

    it('should not add existing license to module-whitelist', async function () {
      const err = await callError('manageLicenseBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'add',
        id: 'module1', key: 'licenseKey1'
      });
      expect(err).to.be.an.instanceof(Meteor.Error);
    });

    it('should add non-existing license to module-whitelist', async function () {
      await Meteor.callAsync('manageLicenseBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'add',
        id: 'module1', key: 'licenseKeyNew'
      });
      const module = await Modules.findOneAsync('module1');
      expect(module).to.exist;
      expect(module.isLicenseWhitelisted('licenseKeyNew')).to.be.true;
    });

    it('should add non-existing license to project-whitelist', async function () {
      await Meteor.callAsync('manageLicenseBWlist', {
        list: 'whitelist', hierarchy: 'project', operation: 'add',
        id: 'project1', key: 'licenseKeyNew'
      });
      const project = await Projects.findOneAsync('project1');
      expect(project).to.exist;
      expect(project.isLicenseWhitelisted('licenseKeyNew')).to.be.true;
    });

    it('should remove existing license from module-whitelist', async function () {
      let module = await Modules.findOneAsync('module1');
      expect(module).to.exist;
      expect(module.isLicenseWhitelisted('licenseKey1')).to.be.true;

      await Meteor.callAsync('manageLicenseBWlist', {
        list: 'whitelist', hierarchy: 'module', operation: 'remove',
        id: 'module1', key: 'licenseKey1'
      });

      module = await Modules.findOneAsync('module1');
      expect(module).to.exist;
      expect(module.isLicenseWhitelisted('licenseKey1')).to.be.false;
    });

    it('should remove existing license from project-whitelist', async function () {
      let project = await Projects.findOneAsync('project1');
      expect(project).to.exist;
      expect(project.isLicenseWhitelisted('licenseKey1')).to.be.true;

      await Meteor.callAsync('manageLicenseBWlist', {
        list: 'whitelist', hierarchy: 'project', operation: 'remove',
        id: 'project1', key: 'licenseKey1'
      });
      project = await Projects.findOneAsync('project1');

      expect(project).to.exist;
      expect(project.isLicenseWhitelisted('licenseKey1')).to.be.false;
    });
  });
});

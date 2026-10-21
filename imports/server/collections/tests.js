import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Tests from '/imports/lib/collections/tests';
import Modules from '/imports/lib/collections/modules';
import Utils from '../ServerUtils';
import {runRefsBelongTo} from '/imports/lib/interactors/testImports/runRefs';

Meteor.publish('tests', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return Tests.find({companyId}, {fields:{data:0}});
  }
  this.ready();
});

Meteor.publish('moduleTests', async function (moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return Tests.find({companyId, moduleId}, {fields:{data:0}})
  }
  this.ready();
});

Meteor.publish('testsDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return Tests.find({companyId, _id});
  }
  this.ready();
});

// The SARIF import modal runs testImports/create.js in the browser, which inserts one test
// per run and then updates the module's quality, so the roles are the module writers' (plus
// the security role, whose tool results these are). Insert only: a run is never edited or
// removed from the client.
const TEST_IMPORT_ROLES = ['developer', 'manager', 'compliance_manager', 'company_component_manager',
  'company_security_manager'];
// The fields testImports/create.js writes. `demo` marks seeded data and is server-only.
const TEST_IMPORT_FIELDS = ['_id', 'type', 'submitted', 'companyId', 'analysisId', 'moduleId', 'scanId',
  'projectName', 'moduleName', 'data', 'status', 'rules', 'tool'];

Tests.allow({
  insert: async function (userId, doc) {
    const user = userId && await Meteor.users.findOneAsync(userId);
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || !doc || doc.companyId !== companyId) {
      return false;
    }
    if (Object.keys(doc).some((field) => TEST_IMPORT_FIELDS.indexOf(field) === -1)) {
      return false;
    }
    if (!await Roles.userIsInRole(userId, TEST_IMPORT_ROLES, companyId)) {
      return false;
    }
    return await moduleInCompany(doc.moduleId, companyId)
      && await runRefsBelongTo({companyId, moduleId: doc.moduleId, analysisId: doc.analysisId, scanId: doc.scanId});
  }
});

// A run may come without a module (the company-wide tests page); one that names a module
// must name a module of the caller's company.
async function moduleInCompany(moduleId, companyId) {
  if (moduleId === undefined || moduleId === null) {
    return true;
  }
  if (typeof moduleId !== 'string' || !moduleId) {
    return false;
  }
  return !!await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {_id: 1}});
}

export let RawTests;

Meteor.startup(function () {
  RawTests = Utils.makeRawCollection(Tests);
  RawTests.createIndex('type');
  RawTests.createIndex('submitted');
  RawTests.createIndex('companyId');
  RawTests.createIndex('moduleId');
  RawTests.createIndex('scanId');
  RawTests.createIndex('analysisId');
  RawTests.createIndex('status');
  RawTests.createIndex('tool');
});



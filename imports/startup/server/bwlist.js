import {Meteor} from 'meteor/meteor';
import {Mongo} from 'meteor/mongo';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';

const INVALID_ARG = 'invalid argument';
const MISSING_ARG = 'missing argument';

const HIERARCHY = ['module', 'project'];
const OPERATION = ['add', 'remove'];
const LIST = ['whitelist', 'blacklist'];

function checkHierarchy(hierarchy) {
  if (HIERARCHY.indexOf(hierarchy) < 0) {
    throw new Meteor.Error(INVALID_ARG, `hierarchy: ${hierarchy} is not allowed`);
  }
}

function checkOperation(operation) {
  if (OPERATION.indexOf(operation) < 0) {
    throw new Meteor.Error(INVALID_ARG, `operation: ${operation} is not allowed`);
  }
}

function checkList(list) {
  if (LIST.indexOf(list) < 0) {
    throw new Meteor.Error(INVALID_ARG, `list: ${list} is not allowed`);
  }
}

function checkMandatory(id, key, version) {
  if (!id) {
    throw new Meteor.Error(MISSING_ARG, 'missing argument: "id"');
  }
  if (!key) {
    throw new Meteor.Error(MISSING_ARG, 'missing argument: "key"');
  }
  if (arguments.length > 2 && !version) {
    throw new Meteor.Error(MISSING_ARG, 'missing argument: "version"');
  }
}

async function getModule(id) {
  const module = await Modules.findOneAsync(id);
  if (!module) throw new Meteor.Error('entity not found', `Module[id=${id}] not found`);
  return module;
}

async function getProject(id) {
  const project = await Projects.findOneAsync(id);
  if (!project) throw new Meteor.Error('entity not found', `Project[id=${id}] not found`);
  return project;
}

// Tenant isolation: a logged-in DDP caller may only manage the BW-lists of a
// project/module owned by their own company. Gated on a present user so the
// no-connection internal/test path (StubCollections, no userId) is unaffected;
// the central DDP guard already requires a userId for these (non-public) methods.
async function assertOwnership(hierarchy, id) {
  const user = await Meteor.userAsync();
  if (!user) {
    return;
  }
  const companyId = user.profile && user.profile.companyId;
  const collection = hierarchy === 'project' ? Projects : Modules;
  const doc = await collection.findOneAsync(id, {fields: {companyId: 1}});
  if (!doc || doc.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

async function updateBWlist(collection, id, listName, data) {
  if (collection instanceof Mongo.Collection === false) {
    throw TypeError('invalie collection type');
  }
  if (data instanceof Object === false) {
    throw TypeError('invalie data type');
  }

  await collection.updateAsync(id, {$set: {[listName]: _.sortBy(data, 'key')}});
}

async function addComponentToProjectBWlist(listName, id, key, version) {
  const project = await getProject(id);
  const newList = project.componentConfig && project.componentConfig[listName] || [];

  newList.push({key: key, version: version});
  await updateBWlist(Projects, id, `componentConfig.${listName}`, newList);
}

async function addComponentToModuleBWlist(listName, id, key, version) {
  const module = await getModule(id);
  const alreadyInList = listName === 'whitelist' ? module.isComponentWhitelisted(key, version)
    : module.isComponentBlacklisted(key, version);
  if (alreadyInList) {
    throw new Meteor.Error('already listed', `component[key=${key}, version=${version}] already in component ${listName}`);
  }

  const newList = module.componentConfig && module.componentConfig[listName] || [];
  newList.push({key: key, version: version});
  await updateBWlist(Modules, id, `componentConfig.${listName}`, newList);
}

async function removeComponentFromProjectBWlist(listName, id, key, version) {
  const project = await getProject(id);

  const oldList = project.componentConfig && project.componentConfig[listName] || [];
  const newList = oldList.filter(l => l.key !== key || l.version !== version);
  await updateBWlist(Projects, id, `componentConfig.${listName}`, newList);
}

async function removeComponentFromModuleBWlist(listName, id, key, version) {
  const module = await getModule(id);

  const oldList = module.componentConfig && module.componentConfig[listName] || [];
  const newList = oldList.filter(l => l.key !== key || l.version !== version);
  await updateBWlist(Modules, id, `componentConfig.${listName}`, newList);
}

async function addLicenseToProjectBWlist(listName, id, key) {
  const project = await getProject(id);
  const newList = project.licenseConfig && project.licenseConfig[listName] || [];

  newList.push({key: key});
  await updateBWlist(Projects, id, `licenseConfig.${listName}`, newList);
}

async function addLicenseToModuleBWlist(listName, id, key) {
  const module = await getModule(id);

  const alreadyInList = listName === 'whitelist' ? module.isLicenseWhitelisted(key) : module.isLicenseBlacklisted(key);
  if (alreadyInList) {
    throw new Meteor.Error('already listed', `license[key=${key}] already in component ${listName}`);
  }

  const newList = module.licenseConfig && module.licenseConfig[listName] || [];

  newList.push({key: key});
  await updateBWlist(Modules, id, `licenseConfig.${listName}`, newList);
}

async function removeLicenseFromProjectBWlist(listName, id, key) {
  const project = await getProject(id);

  const oldList = project.licenseConfig && project.licenseConfig[listName] || [];
  const newList = oldList.filter(l => l.key !== key);
  await updateBWlist(Projects, id, `licenseConfig.${listName}`, newList);
}

async function removeLicenseFromModuleBWlist(listName, id, key) {
  const module = await getModule(id);
  const oldList = module.licenseConfig && module.licenseConfig[listName] || [];
  const newList = oldList.filter(l => l.key !== key);
  await updateBWlist(Modules, id, `licenseConfig.${listName}`, newList);
}

Meteor.methods({
  manageComponentBWlist: async function ({
    list:list = 'whitelist', hierarchy:hierarchy = 'project',
    operation:operation = 'add', id:id, key:key, version:version
  }) {
    checkList(list);
    checkHierarchy(hierarchy);
    checkOperation(operation);
    checkMandatory(id, key, version);
    await assertOwnership(hierarchy, id);

    if (operation === 'add') {
      if (hierarchy == 'project') {
        await addComponentToProjectBWlist(list, id, key, version);
      } else {
        await addComponentToModuleBWlist(list, id, key, version);
      }
    } else {
      if (hierarchy == 'project') {
        await removeComponentFromProjectBWlist(list, id, key, version);
      } else {
        await removeComponentFromModuleBWlist(list, id, key, version);
      }
    }
  },

  manageLicenseBWlist: async function ({
    list:list = 'whitelist', hierarchy:hierarchy = 'project',
    operation:operation = 'add', id:id, key:key
  }) {
    checkList(list);
    checkHierarchy(hierarchy);
    checkOperation(operation);
    checkMandatory(id, key);
    await assertOwnership(hierarchy, id);

    if (operation === 'add') {
      if (hierarchy == 'project') {
        await addLicenseToProjectBWlist(list, id, key);
      } else {
        await addLicenseToModuleBWlist(list, id, key);
      }
    } else {
      if (hierarchy == 'project') {
        await removeLicenseFromProjectBWlist(list, id, key);
      } else {
        await removeLicenseFromModuleBWlist(list, id, key);
      }
    }
  }
});

import {Meteor} from 'meteor/meteor';
import {idSelector} from '/imports/lib/mongoId';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Cves from '/imports/lib/collections/cves';
import QOS from '/imports/lib/component/QOS';
import Utils from '/imports/server/ServerUtils';

export let RawInfrastructureComponents;

// Catalog version-mutation methods below bypass the allow rules, so the
// company_component_manager role must be enforced here. Infrastructure components are a
// global shared catalog (no per-company ownership).
async function assertComponentManager(userId) {
  const user = await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(userId, ['company_component_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

const skipRemoved = {$or: [{removed: {$exists: false}}, {removed: false}]}

Meteor.publish('infrastructureComponents', async function () {
  return InfrastructureComponents.find(skipRemoved)
});

Meteor.publish('getInfrastructureComponent', async function (_id) {
  // These docs carry real ObjectIds, so find('<hex>') would match nothing.
  const compCursor = InfrastructureComponents.find(idSelector(_id));
  const cvesKeys = [];

  (await compCursor.fetchAsync()).forEach(c => {
    const key = c.getKey();
    cvesKeys.push(key);
  });
  const cvesCursor = Cves.find({'key': {$exists: true, $in: cvesKeys}});

  return [compCursor, cvesCursor];
});

// The catalog is global (no company owns a component), so the role is the whole gate.
// The edit page and the commercial-terms buttons update by _id; the component's identity
// (_id, key) never changes from the client. No insert or remove arm:
// InfrastructureComponents.Create is the only way to add a component, so its input rules
// and duplicate checks cannot be skipped, and InfrastructureComponents.Remove / SoftRemove
// are the remove paths.
InfrastructureComponents.allow({
  update: async function (userId, doc, fieldNames, modifier) {
    if (!await isComponentManager(userId)) {
      return false;
    }
    return keepsIdentity(doc, fieldNames, modifier);
  },
  fetch: ['key'],
  // The collection transform wraps the document in a model whose fields sit behind
  // data(); the rule compares raw fields (doc.key), so it needs the plain document.
  transform: null
});

async function isComponentManager(userId) {
  const user = userId && await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  return !!companyId && await Roles.userIsInRole(userId, ['company_component_manager'], companyId);
}

// False when the modifier touches _id or changes the key. The edit pages send the whole
// document back in one $set, so a $set of the unchanged key is accepted.
function keepsIdentity(doc, fieldNames, modifier) {
  if (!Array.isArray(fieldNames) || fieldNames.indexOf('_id') > -1) {
    return false;
  }
  const isKeyPath = (path) => typeof path === 'string' && (path === 'key' || path.indexOf('key.') === 0);
  return Object.keys(modifier || {}).every(function (operator) {
    const params = modifier[operator] || {};
    return Object.keys(params).every(function (field) {
      if (operator === '$rename' && isKeyPath(params[field])) {
        return false;
      }
      if (!isKeyPath(field)) {
        return true;
      }
      return operator === '$set' && field === 'key' && params.key === doc.key;
    });
  });
}

Meteor.methods({
  searchInfrastructureComponentsByFields: async function(queryFields, sorting) {
    let options = {
      limit: 50,
      sort: {name: 1},
      fields: {_id:true, name:true, key:true, description:true, shortDescription:true,
        category:true, urls: true, language:true}
    };
    let filter = {$and:[skipRemoved]}

    if(sorting){
      options.sort = {[(sorting.sort || 'name')]: sorting.order ? +sorting.order : 1}
    }

    for (const key of Object.keys(queryFields)) {
      if(queryFields[key]){
        if(key === 'language'){
          filter['$and'].push({[key]:queryFields[key]});
        }else if(key === 'removed' && queryFields[key] === 'true'){
          filter['$and'].splice(0, 1)
          filter['$and'].push({removed: true});
        }else{
          const regexLine = new RegExp('^.*' + Utils.escapeRegex(queryFields[key]) + '.*' );
          filter['$and'].push({[key]:{$regex: regexLine, $options: 'i'}});
        }
      }
    }

    if(!filter['$and'].length){
      filter = {}
    }

    let list = (await InfrastructureComponents.find(filter, options).fetchAsync()).map(function (component) {
      return component.data()
    })
    return list ? list : [];
  },
  countInfrastructureComponents: async function () {
    return await InfrastructureComponents.find(skipRemoved).countAsync();
  },
  searchInfrastructureComponents: async function(query) {
    let options = {
      limit: 15,
      fields: {name:true, key:true, category:true, commercialTerms:true, versions: true, urls: true}
    };
    let filter = skipRemoved
    if(query.length){
      const regex = new RegExp('^.*' + Utils.escapeRegex(query) + '.*' );
      filter = {$and: [skipRemoved, {$or:[{name: {$regex:  regex, $options: 'i'}}, {category: {$regex:  regex, $options: 'i'}}]}]};
    }
    let list = (await InfrastructureComponents.find(filter, options).fetchAsync()).map(function (component) {
      let item = component.data();
      item.listType = 'infrastructureModule'
      return item
    })
    let cots = (await COTSComponents.find(filter, options).fetchAsync()).map(function (component) {
      let item = component.data();
      item.listType = 'cotsModule'
      return item
    })
    const fallback = list ? list : cots;
    return list && cots ? list.concat(cots) : fallback;
  },

  getInfrastructureComponents: async function () {
    return _.map(await InfrastructureComponents.find(skipRemoved).fetchAsync(),function (component) {
      return component.data();
    })
  },

  findInfrastructureComponentByKey: async function (key) {
    let options = {
      fields: {name:true, key:true, category:true, versions: true, crawlerInfo: true, urls: true,
        language: true, description: true, declaredLicenses: true, effectiveLicenses: true, concludedLicenses: true,
        declaredCopyright: true, shortDescription: true}
    };
    let component = await InfrastructureComponents.findOneAsync({$and:[skipRemoved, {key: key}]}, options)
    return component ? component.data() : false
  },

  removeInfrastructureComponentVersion: async function (componentId, version, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    await assertComponentManager(this.userId);
    await InfrastructureComponents.updateAsync({'_id':componentId, 'versions.version': version},
      { $unset: {'versions.$':  {'version': version}}});
    await InfrastructureComponents.updateAsync({'_id':componentId},
      { $pull: {'versions':  null}});
    await InfrastructureComponents.updateAsync({'_id':componentId},
      { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
  },

  updateInfrastructureComponentVersionLicense: async function (
    componentId, versions, licensesList, versionCopyright, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    await assertComponentManager(this.userId);
    if(versions.length){
      if(licensesList && licensesList.length){
        licensesList = _.map(licensesList, function (license) {
          let newLicense = { qos: QOS.HUMAN, selected: true};
          if(license.key){
            newLicense.key = license.key
          }
          if(license.name){
            newLicense.name = license.name
          }
          if(license.url){
            newLicense.url = license.url
          }
          return newLicense
        })
      }
      let versionDetail = licensesList && licensesList.length ? {'versions.$.licenses':  licensesList} : {};
      if(versionCopyright){
        versionDetail['versions.$.copyright'] = versionCopyright
      }
      if(Object.keys(versionDetail).length > 0){
        for (const version of versions) {
          await InfrastructureComponents.updateAsync({'_id':componentId, 'versions.version': version},
            { $set: versionDetail});
        }
        await InfrastructureComponents.updateAsync({'_id':componentId},
          { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}})
      }
    }
  },

  createInfrastructureComponentVersions: async function (componentId, versions, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    await assertComponentManager(this.userId);
    let list = versions.split(',');
    if(list.length){
      let versionList = _.map(list,function (version) {
        return {
          version: version.trim()
        }
      });
      await InfrastructureComponents.updateAsync({'_id':componentId},
        { $push: {'versions':  {$each: versionList}}});
      await InfrastructureComponents.updateAsync({'_id':componentId},
        { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
    }else {
      let version = {
        version: versions
      };
      await InfrastructureComponents.updateAsync({'_id':componentId},
        { $push: {'versions':  version}});
      await InfrastructureComponents.updateAsync({'_id':componentId},
        { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
    }
  }

});

/**
 * Create global raw Collection and ensure indexes
 */
Meteor.startup(function () {
  RawInfrastructureComponents = Utils.makeRawCollection(InfrastructureComponents);
  RawInfrastructureComponents.createIndex('key');
  RawInfrastructureComponents.createIndex('updated');
  RawInfrastructureComponents.createIndex('crawlerInfo.github.lastVisit');
  RawInfrastructureComponents.createIndex('crawlerInfo.mavencentral-releases.lastVisit');
  RawInfrastructureComponents.createIndex('crawlerInfo.maven2-versions.lastVisit');
  RawInfrastructureComponents.createIndex('crawlerInfo.npm-releases.lastVisit');
  RawInfrastructureComponents.createIndex('crawlerInfo.nuget-releases.lastVisit');
  RawInfrastructureComponents.createIndex('crawlerInfo.pypi.lastVisit');
});

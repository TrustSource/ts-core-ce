import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import {SearchSource} from 'meteor/meteorhacks:search-source';
import Utils from '/imports/server/ServerUtils';
import Components from '/imports/lib/collections/components';
import {containsTextRegex} from '/imports/lib/security/searchRegex';
import QOS from '/imports/lib/component/QOS';
import Cves from '/imports/lib/collections/cves';

export let RawComponents;

const skipRemoved = {$or: [{removed: {$exists: false}}, {removed: false}]}

// Authorize a catalog mutation and return the selector clause the caller may
// touch: `null` for a `company_component_manager` (unrestricted). Anyone else
// is rejected - these methods bypass the `Components.allow` update rule, so the
// role check must live here. Mirrors the update allow rule.
async function componentEditScope(userId) {
  const user = await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  if (await Roles.userIsInRole(userId, 'company_component_manager', companyId)) {
    return null;
  }
  throw new Meteor.Error(403, 'Access Denied');
}

// AND an optional scope clause into a base selector.
function withScope(baseSelector, scope) {
  return scope ? {$and: [baseSelector, scope]} : baseSelector;
}

SearchSource.defineSource('components', async function (searchText) {
  const user = await Meteor.userAsync();
  const options = {
    fields: {logs: 0, crawlerInfo: 0},
    sort: {name:1},
    limit: 30,
    transform: undefined
  };
  const isAdmin = await Roles.userIsInRole(this.userId, 'company_component_manager', user.profile.companyId);

  if (searchText) {
    const searchExp = {name: containsTextRegex(searchText)};
    const selector = isAdmin ? searchExp : {$and: [skipRemoved, searchExp]};

    return Components.find(selector, options).fetchAsync();
  } else {
    return isAdmin ? Components.find({}, options).fetchAsync() :
      Components.find(skipRemoved, options).fetchAsync();
  }
});

SearchSource.defineSource('versionedComponents', async function (searchText) {
  const user = await Meteor.userAsync();
  const options = {
    fields: {logs: 0, crawlerInfo: 0},
    sort: {name:1},
    limit: 30,
    transform: undefined
  };
  const isAdmin = await Roles.userIsInRole(this.userId, 'company_component_manager', user.profile.companyId);

  if (searchText) {
    const searchExp = {
      $or: [
        {name: containsTextRegex(searchText)},
        {key: containsTextRegex(searchText)}
      ],
      'versions.0': {$exists: true}
    };
    const selector = isAdmin ? searchExp : {$and: [skipRemoved, searchExp]};

    return Components.find(selector, options).fetchAsync();
  } else {
    return isAdmin ? Components.find({}, options).fetchAsync() :
      Components.find({$and: [skipRemoved, {'versions.0': {$exists: true}}]}, options).fetchAsync();
  }
});

Meteor.publish('componentDetail', async function (componentId, query) {
  if (typeof componentId !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  const options = {};
  if (componentId !== null) {
    query = {_id: componentId};
  }
  // Logs and crawler details stay manager-only.
  if (!await Roles.userIsInRole(this.userId, 'company_component_manager', user && user.profile.companyId)) {
    options.fields = {logs: 0, 'crawlerInfo.github': 0, 'crawlerInfo.mavencentral-releases': 0,
      'crawlerInfo.nist': 0, 'crawlerInfo.npm-releases': 0, 'crawlerInfo.nuget-releases': 0,
      'crawlerInfo.mavens2-versions': 0};
  }
  const compCursor = Components.find(query, options);
  const cvesKeys = [];

  (await compCursor.fetchAsync()).forEach(c => {
    const key = c.getKey();
    cvesKeys.push(key);
  });
  const cvesCursor = Cves.find({'key': {$exists: true, $in: cvesKeys}});

  return [compCursor, cvesCursor];
});

// The catalog is global (no company owns a component), so the role is the whole gate.
// The edit pages and the commercial-terms buttons update by _id; the component's
// identity (_id, key) never changes from the client. No insert or remove arm:
// Components.Create and Components.SoftRemove are the create and remove paths.
Components.allow({
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

// Shared by getCritical and the package-type facets below.

Meteor.methods({

  searchComponentsByFields: async function(queryFields, sorting, returnFields) {
    let options = {
      limit: 50,
      sort: {name: 1},
      fields: returnFields ||
        {_id:true, name:true, key:true, description:true, shortDescription:true,
          category:true, urls: true, language:true}
    };

    let filter = {$and: [skipRemoved]}

    if(sorting){
      options.sort = {[(sorting.sort || 'name')]: sorting.order ? +sorting.order : 1}
    }

    for (const key of Object.keys(queryFields)) {
      if(queryFields[key]){
        if(key === 'language'){
          filter['$and'].push({[key]:queryFields[key]});
        }else if(key === 'visibility' || key === 'private'){
          // Former visibility controls: every search covers the whole catalog, and
          // an old bookmarked filter must not turn them into a regex criterion.
        }else{
          const regexLine = new RegExp('^.*' + Utils.escapeRegex(queryFields[key]) + '.*' );
          filter['$and'].push({[key]:{$regex: regexLine, $options: 'i'}});
        }
      }
    }

    if(!filter['$and'].length){
      filter = {}
    }

    let list = (await Components.find(filter, options).fetchAsync()).map(function (component) {
      return component.data()
    })
    return list ? list : [];
  },

  getComponentVersions: async function(componentId) {
    if (typeof componentId !== 'string') {
      return [];
    }
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) {
      return [];
    }
    let options = {
      fields: {_id:true, versions:true}
    };
    let component = await Components.findOneAsync({_id: componentId}, options)
    if (!component) {
      return [];
    }
    let list = component.getVersions().map((version)=>{
      return version.data()
    })
    return list ? list : [];
  },


  countComponents: async function () {
    return await Components.find(skipRemoved).countAsync();
  },


  getTopLicenseList: async function () {
    if(RawComponents){
      let topList = await RawComponents.aggregate([
        {$project: {_id: '$_id', keys: '$versions.licenses.key'}}, // creates {_id: , keys: [[]]}
        {$unwind: '$keys'},                                        // creates {_id: keys: []}, {_id: keys: []}
        {$unwind: '$keys'},                                        // creates {_id: keys:}, {_id: keys:}, {_id: keys:}
        {$group: {_id: '$_id', keys: {$addToSet: '$keys'}}},       // creates {_id: key: []} with unique keys
        {$unwind: '$keys'},                                        // creates {_id: keys:}, {_id: keys:},
        {$group: {_id: '$keys', count: {$sum: 1}}},                // creates {_id: key, count: 25}
        {$sort: {count: -1}}                                       // sorts descending
      ], {});
      let totalLic = 0;
      topList.forEach(l => {
        totalLic += l.count;
      });
      topList = topList.slice(0, 20);
      return topList.map(l => {
        return {key: l._id, rate: l.count / totalLic};
      });
    }else {
      return;
    }
  },

  removeVersion: async function (componentId, version, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const scope = await componentEditScope(this.userId);
    await Components.updateAsync(withScope({'_id':componentId, 'versions.version': version}, scope),
      { $unset: {'versions.$':  {'version': version}}});
    await Components.updateAsync(withScope({'_id':componentId}, scope),
      { $pull: {'versions':  null}});
    await Components.updateAsync(withScope({'_id':componentId}, scope),
      { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
  },

  updateVersionLicense: async function (
    componentId, versions, licensesList, versionCopyright, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const scope = await componentEditScope(this.userId);
    if(versions.length && ((licensesList && licensesList.length) || versionCopyright)){
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
      let versionDetail = licensesList && licensesList.length ? {'versions.$.licenses':  licensesList} : {};
      if(versionCopyright){
        versionDetail['versions.$.copyright'] = versionCopyright
      }
      if(versionDetail && Object.keys(versionDetail).length > 0){
        for (const version of versions) {
          await Components.updateAsync(withScope({'_id':componentId, 'versions.version': version}, scope),
            { $set: versionDetail})
        }
        await Components.updateAsync(withScope({'_id':componentId}, scope),
          { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}})
      }
    }
  },

  createComponentVersions: async function (componentId, versions, user) {
    if (typeof componentId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const scope = await componentEditScope(this.userId);
    let list = versions.split(',');
    let component = await Components.findOneAsync(withScope({'_id':componentId}, scope));
    if (!component) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if(list.length){
      let versionList = _.map(_.filter(list, function (version) {
        if(!component.findVersion(version)){
          return version
        }}), function (version) {
        return {
          version: version.trim()
        }
      });
      if(versionList.length){
        await Components.updateAsync({'_id':componentId},
          { $push: {'versions':  {$each: versionList}}});
        await Components.updateAsync({'_id':componentId},
          { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
      }
    }else {
      if(!component.findVersion(versions)){
        let version = {
          version: versions
        };
        await Components.updateAsync({'_id':componentId},
          { $push: {'versions':  version}});
        await Components.updateAsync({'_id':componentId},
          { $set: {'updated':  new Date(), 'updatedBy': user || 'unknown'}});
      }
    }
  }
});

/**
 * Create global raw Collection and ensure indexes
 */
Meteor.startup(function () {
  RawComponents = Utils.makeRawCollection(Components);
  // Unique index on `key` prevents the find-then-insert race from creating duplicate docs.
  Promise.resolve(RawComponents.createIndex({key: 1}, {unique: true, name: 'key_1_unique'}))
    .catch(e => console.error('[Components] failed to create unique index on key:', e && e.message));
  // `oldKey` MUST be indexed. Nine call sites look a component up as
  // {$or: [{key}, {oldKey}]} - processScan.handleDependency runs it once PER DEPENDENCY.
  // MongoDB can only serve an $or from indexes when EVERY branch is indexed; with `oldKey`
  // unindexed the whole $or degrades to a collection scan, measured at 205,440 documents
  // examined and 46ms per lookup against a 205k-document lake (~46s of database time for a
  // single 1000-dependency scan). Indexed, the same lookup examines 1 document.
  // Not sparse. A sparse index also serves today's predicate (verified with explain: both
  // forms give IXSCAN+IXSCAN, 0 documents examined) and would be smaller, since few documents
  // carry `oldKey` at all. The full index is chosen anyway because sparse is only safe for
  // equality on a present value: any future {oldKey: null}, {$ne: ...} or sort on the field
  // would silently drop back to a collection scan, which is exactly the failure being fixed
  // here and is invisible until someone measures it again.
  Promise.resolve(RawComponents.createIndex({oldKey: 1}, {name: 'oldKey_1', background: true}))
    .catch(e => console.error('[Components] failed to create index on oldKey:', e && e.message));
  // `key_1` duplicated `key_1_unique` exactly - same key pattern, no extra selectivity - so
  // every component write paid to maintain two identical B-trees. Dropped rather than merely
  // no longer created, so existing deployments shed it too. Index drops are metadata-only.
  Promise.resolve(RawComponents.dropIndex('key_1'))
    .then(() => console.log('[Components] dropped redundant index key_1 (duplicate of key_1_unique)'))
    .catch(() => { /* already absent - expected on every start after the first */ });
  RawComponents.createIndex('updated');
  RawComponents.createIndex('crawlerInfo.github.lastVisit');
  RawComponents.createIndex('crawlerInfo.mavencentral-releases.lastVisit');
  RawComponents.createIndex('crawlerInfo.maven2-versions.lastVisit');
  RawComponents.createIndex('crawlerInfo.npm-releases.lastVisit');
  RawComponents.createIndex('crawlerInfo.nuget-releases.lastVisit');
  RawComponents.createIndex('crawlerInfo.pypi.lastVisit');
});

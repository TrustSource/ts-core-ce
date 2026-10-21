import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import LicensesService from '/imports/api/licenses';
import Utils from '/imports/server/ServerUtils';
import Projects from '/imports/lib/collections/projects';
import Analysis from '/imports/lib/project/Analysis';
import {stripDangerousOperators, asString} from '/imports/lib/security/sanitizeQuery';

const AD = 'Access Denied'

Meteor.publish('companyAnalysis', async function () {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId){
    return ModuleAnalysis.find({companyId, latest:true});
  }else{
    this.ready();
  }
});

Meteor.publish('moduleAnalysis', async function (moduleId) {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId){
    return ModuleAnalysis.find({companyId, moduleId}, {limit: 100});
  }else{
    this.ready();
  }
});

Meteor.publish('moduleAnalysisById', async function (id) {
  const user = await Meteor.userAsync();
  // Unauthenticated subscribers (and not-found users) yield a null user - bail out
  // instead of dereferencing user.profile, which crashed the subscription.
  if (!user || !user.profile || !user.profile.companyId) {
    return this.ready();
  }
  return ModuleAnalysis.find({_id: id, companyId: user.profile.companyId});
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
ModuleAnalysis.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

ModuleAnalysis.after.insert(async function (userId, doc) {
  const total = await ModuleAnalysis.find({moduleId: doc.moduleId, latest: true}, {fields: {latest:1}}).countAsync();
  if(total > 1){
    let latest = await ModuleAnalysis.findOneAsync(
      {moduleId: doc.moduleId, latest: true},
      {sort: {date: 1}, fields: {latest:1}}
    );
    if(latest){
      await ModuleAnalysis.updateAsync(latest._id,{$set: {latest: false}});
    }
  }
}, {fetchPrevious: false});

ModuleAnalysis.after.remove(async function (userId, doc) {
  if(doc.latest){
    let latest = await ModuleAnalysis.findOneAsync({moduleId: doc.moduleId}, {sort: {date: -1}, limit: 100, fields: {date: 1, latest:1}});
    if(latest){
      await ModuleAnalysis.updateAsync(latest._id, {$set: {latest: true}});
    }
  }
}, {fetchPrevious: false});

Meteor.methods({

  removeSingleAnalysis: async function (analysisId) {
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!user || !await Roles.userIsInRole(user, ['manager', 'compliance_manager', 'company_component_manager'], companyId)) {
      throw new Meteor.Error(403, AD);
    }
    // Both calls below take this value straight as a selector, and findOneAsync and
    // removeAsync each accept an OBJECT as one. A crafted selector could make the
    // lookup return one of the caller's own analyses - passing the tenant check just
    // below - while the remove matched other companies' documents, so only a plain
    // id is accepted.
    const id = asString(analysisId);
    if (!id) {
      throw new Meteor.Error(400, 'Invalid analysis id');
    }
    const analysis = await ModuleAnalysis.findOneAsync(id);
    if (!analysis || analysis.companyId !== companyId) {
      throw new Meteor.Error(403, AD);
    }
    // The owning module's `statistics.analysisId` is deliberately left alone: it
    // labels the statistics blob it ships with, so repointing it at a different
    // analysis while leaving those numbers in place would mislabel them.
    // findOneModuleAnalysis treats that pointer as a preference and falls back to
    // the newest-by-date lookup once it dangles, so nothing needs repointing here.
    return await ModuleAnalysis.removeAsync(id);
  },

  findOneModuleAnalysis: async function (filter, params, preferredId){
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      filter = {};
    }
    filter = stripDangerousOperators(filter);
    // DDP callers are pinned to their own company (ignore any client companyId);
    // trusted REST callers (no userId) keep the server-built filter.companyId.
    if (this.userId) {
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      filter.companyId = companyId;
    }
    // `preferredId` is the analysis the caller's module currently points at
    // (statistics.analysisId). It exists so the client-side ReactiveMethod cache key
    // moves when a re-analysis repoints the module - see getModuleData in router.js.
    // It is a preference, not a selector: applied ON TOP of the filter above (which
    // carries the company pin), and when it resolves to nothing - the analysis was
    // deleted, or the pointer predates it - the sorted lookup below still answers,
    // so a module page never renders as having no analysis at all. The second query
    // therefore only runs in that stale case, rather than fetching a potentially
    // large analysis document twice on every page load.
    //
    // An explicitly pinned `filter._id` - the `?analysis=` deep link the approve and
    // release views use - is a HARD selector and outranks the preference. The
    // `_.extend` below merges the preferred id last, so applying both would silently
    // swap the pinned analysis for the module's current one; drop the preference
    // instead, which also keeps a pinned lookup down to a single query.
    if (filter._id !== undefined && filter._id !== null) {
      preferredId = undefined;
    }
    const preferred = asString(preferredId);
    if (preferred) {
      const found = await ModuleAnalysis.findOneAsync(
        _.extend({}, filter, {_id: preferred}), params);
      if (found) {
        return found;
      }
    }
    return await ModuleAnalysis.findOneAsync(filter, params);
  },

  getAnalysis: async function (analysisId) {
    if (typeof analysisId !== 'string') {
      return undefined;
    }
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    if (!companyId) {
      return undefined;
    }
    return await ModuleAnalysis.findOneAsync({_id: analysisId, companyId});
  },

  getTotalLicensesAndComponents: async function (companyId) {
    let licSum = 0, compSum = 0;
    const userId = this.userId;
    const userCompanyId = await Utils.getCompanyIdForUserAsync(userId);
    // A logged-in (DDP) caller may only query their own company; the explicit
    // companyId argument is reserved for trusted server/REST calls (no userId).
    if (userId && companyId && companyId !== userCompanyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    let filter = companyId ? {
      companyId: companyId
    }:{
      $and: [{
        companyId: companyId || userCompanyId
      }, {
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': userId},
          {'relatedUsers.defaultProjectManager': userId},
          {'relatedUsers.defaultComplianceManager': userId}
        ]
      }]
    };
    const modules = await Modules.find(filter).fetchAsync();
    for (const p of modules) {
      let a = await p.getAnalysisAsync();
      if(a){
        a = new Analysis(a)
      }
      if (a) {
        licSum += a.getTotalLicenseCnt();
        compSum += a.getTotalComponentCnt();
      }
    }
    return {licenses: licSum, components: compSum};
  },

  getModulesChartData: async function (companyId, returnRawData) {
    const MAX_MODULES = 20;

    const userId = this.userId;
    const userCompanyId = await Utils.getCompanyIdForUserAsync(userId);
    // A logged-in (DDP) caller may only query their own company; the explicit
    // companyId argument is reserved for trusted server/REST calls (no userId).
    if (userId && companyId && companyId !== userCompanyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    let filter = {
      $and: [{
        companyId: companyId || userCompanyId
      }, {
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': userId},
          {'relatedUsers.defaultProjectManager': userId},
          {'relatedUsers.defaultComplianceManager': userId}
        ]
      }]
    };
    const fetchedModules = await Modules.find(filter).fetchAsync();
    let modulesArr = [];
    for (const p of fetchedModules) {
      const a = await p.getAnalysisAsync();
      let licCnt = 0, compCnt = 0;
      if (a && typeof a.getTotalComponentCnt === 'function') {
        compCnt = a.getTotalComponentCnt();
        licCnt = a.getTotalLicenseCnt();
      }
      modulesArr.push({_id: p._id, name: p.name || 'unknown', licenses: licCnt, components: compCnt});
    }
    if(returnRawData){
      return modulesArr
    }
    const data = {
      labels: [],
      ids: [],
      datasets: [
        {
          label: 'Components',
          backgroundColor: '#2a94a2',
          hoverBackgroundColor: '#2a94a2',
          data: []
        },
        {
          label: 'Licenses',
          backgroundColor: '#feba49',
          hoverBackgroundColor: '#feba49',
          data: []
        }
      ]
    };
    modulesArr = _.sortBy(modulesArr, p => -p.components);
    modulesArr = _.first(modulesArr, MAX_MODULES);

    _.forEach(modulesArr, p => {
      data.labels.push(p.name);
      data.ids.push(p._id);
      data.datasets[0].data.push(p.components);
      data.datasets[1].data.push(p.licenses);
    });

    return data;
  },

  getLicenseStatistics: async function (projectId, moduleIds, moduleConfig, companyId, returnRawData) {
    const MAX_LICENSES = 7;
    // const COLORS = ['#063d50', '#4a8090', '#4381b8', '#2a94a2', '#feba49', '#f35f34', '#f14646', '#cf4747'];
    const COLORS = ['#063d50', '#4a8090', '#4381b8', '#2a94a2', '#feba49', '#f35f34', '#cf4747'];
    const stats = {};
    let statsArr;

    const userId = this.userId;
    const userCompanyId = await Utils.getCompanyIdForUserAsync(userId);
    // A logged-in (DDP) caller may only query their own company; the explicit
    // companyId argument is reserved for trusted server/REST calls (no userId).
    if (userId && companyId && companyId !== userCompanyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    let filter = {
      $and: [{
        companyId: companyId || userCompanyId
      }, {
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': userId},
          {'relatedUsers.defaultProjectManager': userId},
          {'relatedUsers.defaultComplianceManager': userId}
        ]
      }]
    };
    if (projectId){
      const project = await Projects.findOneAsync(projectId,{fields: {name:1}});
      if(project){
        filter.projectId = projectId;
      }
    }
    if(moduleIds){
      filter._id = { $in : moduleIds}
    }
    // accumulate all modules, store result in stats
    const moduleDocs = await Modules.find(filter).fetchAsync();
    for (const p of moduleDocs) {
      let config = moduleConfig ? moduleConfig.find((item)=>{
        return item._id === p._id
      }): null
      const a = await p.getAnalysisAsync(null, config && config.analysisId);
      if (a && typeof a.getLicensesComponentsCnt === 'function' ) {
        let pStat = a.getLicensesComponentsCnt();
        for (let k in pStat) {
          if (stats[k]) {
            stats[k] += pStat[k];
          } else {
            stats[k] = pStat[k];
          }
        }
      }
    }
    if(returnRawData){
      return stats
    }
    // now we have [["licKey", count], ["lickey2", count2]]
    statsArr = _.pairs(stats);

    // sort by count desc;
    statsArr = _.sortBy(statsArr, v => -v[1]);

    // summ up all entries >= MAX_LICENSE and store their value at statsArr[MAX_LICENSE-1] name of this entry is "others"
    if (statsArr[MAX_LICENSES - 1] && statsArr[MAX_LICENSES]) {
      for (let i = MAX_LICENSES; i < statsArr.length; i++) {
        statsArr[MAX_LICENSES - 1][1] += statsArr[i][1];
      }
      statsArr[MAX_LICENSES - 1][0] = 'others';
      statsArr = _.sortBy(statsArr, v => -v[1]);
    }

    // limit result size
    statsArr = _.first(statsArr, MAX_LICENSES);
    // lookup license name and convert to appropriate object
    statsArr = _.map(statsArr, (v, i) => {
      if (v[0] !== 'null' && v[0] !== 'others') {
        let lic = LicensesService.find(v[0]);
        if (lic) {
          v[0] = lic.name;
        }
      }
      return {
        label: v[0] === 'null' ? 'unknown' : v[0],
        value: v[1],
        highlight: COLORS[i],
        color: COLORS[i]
      };
    });
    let datasets = [];
    let labels = _.map(statsArr, (v) => {
      return v.label
    });
    datasets[0] = {};
    datasets[0].data = _.map(statsArr, (v) => {
      return v.value
    });
    datasets[0].backgroundColor = _.map(statsArr, (v) => {
      return v.color
    });
    datasets[0].hoverBackgroundColor = _.map(statsArr, (v) => {
      return v.highlight
    });
    datasets[0].pointHoverBorderColor = _.map(statsArr, () => {
      return '#000'
    });
    return {
      datasets: datasets,
      labels: labels
    };
  }

});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawModuleAnalysis;

Meteor.startup(function () {
  RawModuleAnalysis = Utils.makeRawCollection(ModuleAnalysis);
  RawModuleAnalysis.createIndex('companyId');
  RawModuleAnalysis.createIndex('moduleId');
  RawModuleAnalysis.createIndex('scanId');
  RawModuleAnalysis.createIndex('date');
  RawModuleAnalysis.createIndex('latest');
  RawModuleAnalysis.createIndex('release');
  RawModuleAnalysis.createIndex('tag');
  RawModuleAnalysis.createIndex('branch');
});

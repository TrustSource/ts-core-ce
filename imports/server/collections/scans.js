import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Utils from '/imports/server/ServerUtils';
import Scans from '/imports/lib/collections/scans';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Approves from '/imports/lib/collections/approves';
import Projects from '/imports/lib/collections/projects';
import ServerSideCollection from '/imports/server/serverSideCollection';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';

Meteor.publish('scanDetail', async function (id) {
  if (typeof id !== 'string') { return this.ready(); }
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  if(this.userId && companyId){
    return Scans.find({_id: id, companyId: companyId});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Scans.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

if (Meteor.isServer) {
  const ScansListFields = {
    submitted: true,
    project: true,
    module: true,
    moduleId: true,
    user: true,
    dependencyCount: true,
    release: true,
    tag: true,
    branch: true,
    binaryLinks: true
  }
  Meteor.methods({
    'Scans.Find': async function(selector, sort, page, size, fields) {
      if (!fields) {
        fields = ScansListFields
      }
      // The selector is client input: strip Mongo operators ($where etc.) and
      // pin it to the caller's company. A caller with no company is refused, not
      // served an unscoped query.
      selector = stripDangerousOperators(selector) || {};
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      selector.companyId = companyId;
      return ServerSideCollection.find(Scans, {selector, sort, page, size, fields, limit:200})
    },
    'Scans.FindOne': async function(_id, selector, sort, fields) {
      selector = stripDangerousOperators(selector) || {};
      selector._id = _id;
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      selector.companyId = companyId;
      return await ServerSideCollection.findOne(Scans, {selector, sort, fields})
    }
  })
}

Meteor.methods({
  getLastModuleScan: async function (moduleId, analysisId) {
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    if (!companyId) {
      return undefined;
    }
    if(analysisId){
      const analysis = await ModuleAnalysis.findOneAsync({_id: analysisId, companyId}, {fields: {scanId: 1}})
      if(analysis){
        return await Scans.findOneAsync({_id: analysis.scanId, companyId})
      }
    }
    return await Scans.findOneAsync({moduleId: moduleId, companyId}, {sort: {submitted: -1}})
  },
  getLastScanAnalysis: async function (scanId) {
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    if (!companyId) {
      return undefined;
    }
    return await ModuleAnalysis.findOneAsync({scanId, companyId}, {sort: {date: -1}, fields: {scanId: 1}})
  },
  getLastScanModule: async function (moduleId) {
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    if (!companyId) {
      return undefined;
    }
    return await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {projectId: 1, moduleId: 1}})
  },
  componentLinkWithRelease: async function (params) {
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(403, 'Access Denied');
    const {_id, key, versions} = params.component
    const release = {
      _id,
      key,
      versions,
      approve: params.approve
    }
    if(params.moduleId){
      const module = await Modules.findOneAsync(params.moduleId, {fields: {companyId: 1}});
      if (!module || module.companyId !== user.profile.companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      const result = await Modules.updateAsync(params.moduleId, {$push: {linkedReleases: release}});
      if(result === 1){
        await Meteor.callAsync('logEvent', user, 'Link with Release '+ release.approve.name+' created', 'scanComponentLinkCreate');
      }
      return result
    }
  },
  componentUnlinkWithRelease: async function (params) {
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(403, 'Access Denied');
    const link = params.link
    const module = await Modules.findOneAsync(params.moduleId, {fields: {linkedReleases: 1, companyId: 1}});
    if (!module || module.companyId !== user.profile.companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!module.linkedReleases) return 0;
    const filteredArr = _.reject(module.linkedReleases, function (e) {
      return e._id === link._id && e.key === link.key;
    });
    const result = await Modules.updateAsync(params.moduleId, {$set: {linkedReleases: filteredArr}});
    if(result === 1){
      await Meteor.callAsync('logEvent', user, 'Link with Release '+ link.approve.name+' removed', 'scanComponentLinkRemove');
    }
    return result
  },
  componentLinkWithModule: async function (params) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, ['manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!params.moduleId) throw new Meteor.Error('missing-param', 'moduleId is required');
    const sourceModule = await Modules.findOneAsync(params.moduleId, {fields: {companyId: 1}});
    if (!sourceModule || sourceModule.companyId !== user.profile.companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const {_id, key, versions} = params.component;
    let stats = null;
    let approve = null;
    let moduleRef = null;
    let logLabel = '';
    if (params.approve && params.approve._id) {
      const approveDoc = await Approves.findOneAsync(params.approve._id, {
        fields: {name: 1, version: 1, stats: 1, approved: 1, projectId: 1}
      });
      if (!approveDoc) throw new Meteor.Error('not-found', 'Release not found');
      approve = {_id: approveDoc._id, name: approveDoc.name, version: approveDoc.version};
      stats = approveDoc.stats || null;
      let projectName = null;
      if (approveDoc.projectId) {
        const project = await Projects.findOneAsync(approveDoc.projectId, {fields: {name: 1}});
        projectName = project ? project.name : null;
      }
      approve.projectId = approveDoc.projectId || null;
      approve.projectName = projectName;
      logLabel = 'Release ' + approveDoc.name;
    }
    if (params.module && params.module._id) {
      const targetModule = await Modules.findOneAsync(params.module._id, {
        fields: {name: 1, version: 1, projectId: 1, statistics: 1, analyzed: 1}
      });
      if (!targetModule) throw new Meteor.Error('not-found', 'Target module not found');
      let projectName = null;
      if (targetModule.projectId) {
        const project = await Projects.findOneAsync(targetModule.projectId, {fields: {name: 1}});
        projectName = project ? project.name : null;
      }
      moduleRef = {
        _id: params.module._id,
        name: targetModule.name,
        version: targetModule.version || null,
        projectId: targetModule.projectId || null,
        projectName
      };
      if (!stats) {
        const analysis = await ModuleAnalysis.findOneAsync(
          {moduleId: params.module._id, latest: true},
          {fields: {statistics: 1}, sort: {date: -1}}
        );
        stats = analysis && analysis.statistics ? analysis.statistics : null;
      }
      if (!stats && targetModule.statistics) {
        stats = targetModule.statistics;
      }
      logLabel = logLabel || ('Module ' + targetModule.name);
    }
    const linkedModule = {
      _id,
      key,
      versions,
      module: moduleRef,
      approve,
      stats,
      linkedAt: new Date()
    };
    const result = await Modules.updateAsync(params.moduleId, {$push: {linkedModules: linkedModule}});
    if (result === 1) {
      await Meteor.callAsync('logEvent', user, 'Link with ' + logLabel + ' created', 'scanComponentModuleLinkCreate');
    }
    return result;
  },
  componentUnlinkWithModule: async function (params) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, ['manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!params.moduleId) throw new Meteor.Error('missing-param', 'moduleId is required');
    const link = params.link;
    const module = await Modules.findOneAsync(params.moduleId, {fields: {linkedModules: 1, companyId: 1}});
    if (!module || module.companyId !== user.profile.companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!module.linkedModules) return 0;
    const filteredArr = _.reject(module.linkedModules, function (e) {
      return e._id === link._id && e.key === link.key;
    });
    const result = await Modules.updateAsync(params.moduleId, {$set: {linkedModules: filteredArr}});
    if (result === 1) {
      const moduleName = link.module ? link.module.name : link.key;
      await Meteor.callAsync('logEvent', user, 'Link with Module ' + moduleName + ' removed', 'scanComponentModuleLinkRemove');
    }
    return result;
  },
  getModulesForLinking: async function (params) {
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(403, 'Access Denied');
    const companyId = user.profile.companyId;
    const filter = {companyId};
    if (params && params.excludeModuleId) {
      filter._id = {$ne: params.excludeModuleId};
    }
    const modules = await Modules.find(filter, {
      fields: {name: 1, version: 1, projectId: 1, statistics: 1, analyzed: 1}
    }).fetchAsync();
    const projectCache = {};
    async function getProjectName(projectId) {
      if (!projectId) return null;
      if (projectCache[projectId] !== undefined) return projectCache[projectId];
      const project = await Projects.findOneAsync(projectId, {fields: {name: 1}});
      projectCache[projectId] = project ? project.name : null;
      return projectCache[projectId];
    }
    const moduleResults = [];
    for (const mod of modules) {
      const projectName = await getProjectName(mod.projectId);
      moduleResults.push({
        _id: mod._id,
        name: mod.name,
        version: mod.version || null,
        projectId: mod.projectId || null,
        projectName,
        stats: mod.statistics || null,
        lastAnalyzed: mod.analyzed || null
      });
    }
    const approves = await Approves.find(
      {companyId, approved: {$exists: true}},
      {fields: {name: 1, version: 1, approved: 1, projectId: 1, modules: 1, stats: 1, closedByName: 1}, sort: {approved: -1}}
    ).fetchAsync();
    const releaseResults = [];
    for (const a of approves) {
      const projectName = await getProjectName(a.projectId);
      releaseResults.push({
        _id: a._id,
        name: a.name,
        version: a.version || null,
        approved: a.approved,
        projectId: a.projectId || null,
        projectName,
        closedByName: a.closedByName || null,
        stats: a.stats || null
      });
    }
    return {modules: moduleResults, releases: releaseResults};
  },
  refreshLinkedModuleStats: async function (params) {
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(403, 'Access Denied');
    const {moduleId, linkKey} = params;
    if (!moduleId) throw new Meteor.Error('missing-param', 'moduleId is required');
    const module = await Modules.findOneAsync(moduleId, {fields: {linkedModules: 1, companyId: 1}});
    // Tenant isolation: only operate on a module owned by the caller's company.
    if (!module || module.companyId !== user.profile.companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!module.linkedModules) return 0;
    const linkIndex = module.linkedModules.findIndex(function (e) {
      return e.key === linkKey;
    });
    if (linkIndex === -1) return 0;
    const link = module.linkedModules[linkIndex];
    let stats;
    if (link.approve && link.approve._id) {
      const approveDoc = await Approves.findOneAsync(link.approve._id, {fields: {stats: 1}});
      stats = approveDoc ? approveDoc.stats : null;
    } else if (link.module && link.module._id) {
      const analysis = await ModuleAnalysis.findOneAsync(
        {moduleId: link.module._id, latest: true},
        {fields: {statistics: 1}, sort: {date: -1}}
      );
      stats = analysis ? analysis.statistics : null;
    } else {
      stats = null;
    }
    module.linkedModules[linkIndex].stats = stats;
    return await Modules.updateAsync(moduleId, {$set: {linkedModules: module.linkedModules}});
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawScans;

Meteor.startup(function () {
  RawScans = Utils.makeRawCollection(Scans);
  RawScans.createIndex('companyId');
  RawScans.createIndex('moduleId');
  RawScans.createIndex('project');
  RawScans.createIndex('module');
  RawScans.createIndex('user');
  RawScans.createIndex('branch');
  RawScans.createIndex('tag');
  RawScans.createIndex('dependencyCount');
  // Backs the scan list / search query: equality on companyId + sort on submitted.
  // Also serves any companyId-scoped query (compound prefix), and any
  // {moduleId, sort:submitted} query (which uses the moduleId index and sorts
  // in-memory on the small result set). The standalone {submitted:1} index
  // was removed - no caller queries `submitted` without `companyId`, and
  // having it caused the planner to walk the whole collection in submitted
  // order for filtered queries.
  RawScans.createIndex({companyId: 1, submitted: -1});
});

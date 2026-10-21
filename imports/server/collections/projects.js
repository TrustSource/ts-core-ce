/* global Random:false, Promise: false, Map: false, Set: false */
import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import RequirementsHistory from '/imports/lib/collections/requirementsHistory';
import Utils from '/imports/server/ServerUtils';
import {ProjectSchema} from '/imports/lib/schemas/projectSchema';
import {normalizeProjectName} from '/imports/lib/project/projectName';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Companies from '/imports/lib/collections/companies';
import Scans from '/imports/lib/collections/scans';
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Approves from '/imports/lib/collections/approves';
import DemoData from '/imports/lib/demo/demoData';
import SemverExt from '/imports/lib/component/SemverExt';
import ApprovalReports from '/imports/lib/collections/approvalReports';
import Tests from '/imports/lib/collections/tests';
import {pathLocation, pathLabel} from '/imports/lib/analysis/pathLocation';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import Products from '/imports/lib/collections/products';
import Component from '/imports/lib/component/Component';
import processScan from '/imports/server/scan/processScan';
import Approve from '/imports/lib/project/Approve';
import License from '/imports/lib/component/License';
import Module from '/imports/lib/project/Module';
import ServerUtils from '/imports/server/ServerUtils';
import {tsEpssScores, resolveEpss} from '/imports/startup/server/ts-epss';
// Extracted so the vulnerability-alert sweep can run them with no DDP user, and
// so the batched `cves` lookup and the CVE-level release difference exist in ONE
// place. The two methods below are now thin wrappers.
import {computeProjectVulnerabilityLive, computeVulnerabilityDifference,
  collectPathsFromComponentList, resolveDifferenceCompanyId,
  isCveWhitelisted} from '/imports/lib/interactors/projects/vulnerabilityLive';

const UNASSIGNED = 'Unassigned Modules'
const IE = 'Internal Error: '
const CP_FIND = 'CryptoProperties.Find'
const AP_FIND = 'AiProperties.Find'

function collectEndoflifeData(component, versions, problems) {
  _.each(component.problems.endoflife, function (endoflife) {
    versions.push(endoflife.version);
    problems.push(endoflife);
  });
}

function collectLicensesFromPath(path, component, projectId, moduleIds, licenses) {
  _.each(path.licenses, function (license) {
    license.component = {
      path: pathLocation(path),
      componentKey: component.key,
      projectId: projectId,
      moduleId: component.moduleId || moduleIds ? moduleIds[0] : false
    };
    licenses.push(license)
  });
}

function collectPathsWithProjectFromComponentList(componentList, newComponent) {
  let counter = 0;
  newComponent.paths = [];
  _.each(componentList, function (comp) {
    _.each(comp.versions, function (ver) {
      if(newComponent.versions.indexOf(ver.version) > -1){
        _.each(ver.paths, function (path) {
          let pathObject = {
            path: pathLabel(comp.moduleName, path),
            componentKey: comp.key,
            moduleId: comp.module._id,
            projectId: comp.module.projectId
          };
          newComponent.paths.push(pathObject);
          counter++
        });
      }
    });
  });
  return counter;
}

// Integration credentials embedded in the project doc must never be published
// to the client (the values are only read server-side via ProjectsGetXxxCredentials).
const PROJECT_SECRET_FIELDS = {'jira.passwd': 0, 'tfs.token': 0, 'github.token': 0};

Meteor.publish('projectsById', async function (projectId, limited) {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId && userId){
    const user = await Meteor.userAsync();
    let fields = limited ? {companyId:1, name:1, relatedUsers:1, classification:1, requirements:1, confidenceMinScore: 1} : PROJECT_SECRET_FIELDS
    if(await Roles.userIsInRole(user, ['portfolio_manager'], companyId)){
      return Projects.find({_id:projectId, companyId: companyId}, {fields});
    }else{
      return Projects.find({
        $and: [{_id:projectId, companyId: companyId},{
          $or: [
            {'relatedUsers': { $exists: false }},
            {'relatedUsers.members': { $exists: false }},
            {'relatedUsers.members': []},
            {'relatedUsers.members': userId},
            {'relatedUsers.defaultProjectManager': userId},
            {'relatedUsers.defaultComplianceManager': userId}
          ]}
        ]
      }, {fields});
    }
  }
  this.ready();
});

Meteor.publish('projectsByCompany', async function (limited) {
  const userId = this.userId;
  if (!userId) { return this.ready(); }
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(!companyId){
    return this.ready();
  }
  let fields = limited ? {companyId:1, name:1, relatedUsers:1, classification:1, tags:1, licenseConfig:1, componentConfig:1,
    cveConfig:1, obligationConfig:1, legalRulesConfig:1, demo:1, requireWhitelist: 1, description: 1,
    'github.active': 1, 'github.repository': 1, requirements:1, confidenceMinScore: 1, algorithmsConfig: 1, ciaRequirements: 1,
    analyzed: 1, moduleCount: 1}
    : PROJECT_SECRET_FIELDS
  if(await Roles.userIsInRole(userId, ['portfolio_manager'], companyId)){
    return Projects.find({companyId: companyId}, {fields});
  }else{
    return Projects.find({
      $and: [{companyId: companyId},{
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': userId},
          {'relatedUsers.defaultProjectManager': userId},
          {'relatedUsers.defaultComplianceManager': userId}
        ]}
      ]
    }, {fields});
  }
});

Meteor.publish('projects', async function () {
  const userId = this.userId;
  if (!userId) { return this.ready(); }
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(!companyId){
    return this.ready();
  }
  if(await Roles.userIsInRole(userId, ['portfolio_manager'], companyId)){
    return Projects.find({
      companyId: companyId
    }, {fields: PROJECT_SECRET_FIELDS});
  }else{
    return Projects.find({
      $and: [{
        companyId: companyId
      },{
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': userId},
          {'relatedUsers.defaultProjectManager': userId},
          {'relatedUsers.defaultComplianceManager': userId}
        ]}
      ]
    }, {fields: PROJECT_SECRET_FIELDS});
  }
});

// No `insert` arm: creating a project from the client goes through the
// `Projects.Create` method (imports/lib/interactors/projects/create.js),
// and Meteor denies a client insert when no allow rule matches.
// An allow rule could not trim the name, could not derive the tenant from the
// session (it compared a CLIENT-SUPPLIED `doc.companyId`), and returns a boolean
// so it could not answer "that name is taken".
Projects.allow({
  update: async function (userId, doc, fieldNames, modifier) {
    const user = await Meteor.userAsync();
    if (checkIfFollowing(userId, user, doc, fieldNames, modifier)) {
      return true
    }
    // The third project-name write path: the `updateProjectForm` AutoForm rename on
    // Project Settings > General writes this modifier over DDP, and stored an
    // untrimmed name until now. Normalised IN PLACE and BEFORE validation, so the
    // value that is validated is the value that gets written: allow-deny's
    // `_validatedUpdateAsync` hands the SAME `mutator` object to every validator and
    // then passes that object to the driver's updateAsync. It is also the mechanism
    // collection2 itself uses - its `firstDeny` update rule cleans "the referenced
    // modifier ... in place".
    //
    // Guarded on the type rather than assigned unconditionally: `normalizeProjectName`
    // answers undefined for a non-string, the Meteor driver runs with
    // `ignoreUndefined: true`, so assigning it would DROP `name` from the modifier and
    // turn a rename that should be rejected into a silent success that changed nothing.
    // Left untouched, `isModificationAllowed` still rejects it.
    if (modifier && modifier.$set && typeof modifier.$set.name === 'string') {
      modifier.$set.name = normalizeProjectName(modifier.$set.name);
    }
    return (await checkRoleAndCompany(doc)) && isModificationAllowed(fieldNames, modifier);
  },
  remove: async function (userId, doc) {
    if(doc && doc._id){
      return (await checkRoleAndCompany(doc)) && await Modules.find({projectId: doc._id}).countAsync() === 0;
    }
  }
});

Projects.after.update(async function (userId, doc, fieldNames, modifier) {
  if(fieldNames.indexOf('requirements') > -1 && modifier && modifier['$set'] && modifier['$set'].requirements){
    try {
      const commonSettings = { companyId: doc.companyId, moduleId: {$exists: false}, projectId: doc._id }
      const latest = await RequirementsHistory.findOneAsync(commonSettings, {sort: {created: -1}})
      const requirements = modifier['$set'].requirements
      if(!latest || (latest && JSON.stringify(latest.requirements) !== JSON.stringify(requirements))){
        const allSimilarCount = await RequirementsHistory.find(commonSettings).countAsync()
        if(allSimilarCount > 9){
          let oldest = await RequirementsHistory.findOneAsync(commonSettings, {sort: {created: 1}})
          if(oldest){
            await RequirementsHistory.removeAsync(oldest._id)
          }
        }
        const user = await Meteor.users.findOneAsync(userId);
        let model = {
          created: new Date(),
          projectId: commonSettings.projectId,
          companyId: commonSettings.companyId,
          userId: userId,
          userName: Utils.username(user),
          requirements: requirements
        }
        await RequirementsHistory.insertAsync(model)
      }
    }catch (e) {
      console.log('Projects.after.update: ',e)
    }
  }
}, {fetchPrevious: false});

Modules.after.remove(async function (userId, doc) {
  const commonSettings = { companyId: doc.companyId, moduleId: {$exists: false}, projectId: doc._id }
  await RequirementsHistory.removeAsync(commonSettings)
}, {fetchPrevious: false});

// Follow/unfollow (common/follow.js) by any member of the project's company.
function checkIfFollowing(userId, user, doc, fieldNames, modifier) {
  if(Object.keys(modifier).length === 1 && Object.keys(modifier)[0] === '$set' &&
    Object.keys(modifier.$set).length === 1 && Object.keys(modifier.$set)[0] === 'relatedUsers.followers'){
    return !!user && userId === user._id && fieldNames.length === 1 && fieldNames.indexOf('relatedUsers') > -1
      && !!doc && !!user.profile && doc.companyId === user.profile.companyId;
  }
}

// Loading and removing the demo project: the same roles as Projects.Create (and as
// the buttons, which only show for them). Loading creates a project, module and scan
// and runs a full analysis; removing deletes every demo document of the company, so
// neither is open to a read-only member. Always the session user: removeDemoData
// used to fall back to a caller-supplied user object.
const DEMO_DATA_ROLES = ['manager', 'compliance_manager'];

async function requireDemoDataUser() {
  const user = await Meteor.userAsync();
  if (!user || !user.profile || !user.profile.companyId) {
    throw new Meteor.Error(401, 'Not authorized');
  }
  if (!(await Roles.userIsInRole(user, DEMO_DATA_ROLES, user.profile.companyId))) {
    throw new Meteor.Error(403, 'Not authorized');
  }
  return user;
}

// Fields the Project Settings > General form (updateProjectForm) saves together.
const GENERAL_FORM_FIELDS = ['name', 'description', 'leanix', 'tags', 'confidenceMinScore', 'relatedUsers'];

async function checkRoleAndCompany(doc) {
  const currUser = await Meteor.userAsync();
  if (currUser && (await Roles.userIsInRole(currUser, ['manager', 'compliance_manager'], currUser.profile.companyId))) {
    return currUser.profile.companyId === doc.companyId;
  }
  return false;
}

function isModificationAllowed(fieldNames, modifier) {
  if (fieldNames.length === 1 && fieldNames[0] === 'name'
    && _.size(modifier) === 1 && modifier.$set) {
    return ProjectSchema.newContext().validateOne(modifier, 'name', {modifier: true});
  } else if (fieldNames.length === 2 && fieldNames.indexOf('description') !== -1 && fieldNames.indexOf('name') !== -1) {
    return ProjectSchema.newContext().validateOne(modifier, 'description', {modifier: true});
  } else if (fieldNames.length === 2 && fieldNames.indexOf('leanix') !== -1 && fieldNames.indexOf('name') !== -1) {
    return ProjectSchema.newContext().validateOne(modifier, 'leanix', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'licenseConfig') {
    return ProjectSchema.newContext().validateOne(modifier, 'licenseConfig', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'componentConfig') {
    return ProjectSchema.newContext().validateOne(modifier, 'componentConfig', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'obligationConfig') {
    return ProjectSchema.newContext().validateOne(modifier, 'obligationConfig', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'legalRulesConfig') {
    return ProjectSchema.newContext().validateOne(modifier, 'legalRulesConfig', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'release') {
    return ProjectSchema.newContext().validateOne(modifier, 'release', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'requireWhitelist') {
    return ProjectSchema.newContext().validateOne(modifier, 'requireWhitelist', {modifier: true});
  } else if (fieldNames.indexOf('relatedUsers') > -1) {
    // Only the general form's own fields may ride along, each one validated.
    if (!fieldNames.every((field) => GENERAL_FORM_FIELDS.indexOf(field) > -1)) {
      return false;
    }
    const context = ProjectSchema.newContext();
    return fieldNames.every((field) => context.validateOne(modifier, field, {modifier: true}));
  } else if (fieldNames.length === 1 && fieldNames[0] === 'requirements') {
    return ProjectSchema.newContext().validateOne(modifier, 'requirements', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'ciaRequirements') {
    return ProjectSchema.newContext().validateOne(modifier, 'ciaRequirements', {modifier: true});
  } else if (fieldNames.length === 1 && fieldNames[0] === 'endoflifePolicy') {
    return ProjectSchema.newContext().validateOne(modifier, 'endoflifePolicy', {modifier: true});
  }
  return false;
}

function isUnchanged(module, componentKey, version, path) {
  return module && module.isComponentUnchanged && module.isComponentUnchanged(componentKey, version, path);
}

// Resolve the company a getProjectXXX report runs against. The many
// `getProjectXxx(projectId, companyId, ...)` methods scope their Mongo queries by
// the passed companyId, so a DDP client could pass another tenant's companyId +
// that tenant's projectId to read its data. DDP callers are therefore always
// pinned to their OWN company (the client value is ignored); REST callers run
// with no DDP user and pass the apikey's company, which is authoritative.
async function projectScopedCompanyId(clientCompanyId) {
  const user = await Meteor.userAsync();
  return user ? (user.profile && user.profile.companyId) : clientCompanyId;
}

Meteor.methods({
  getProjectObligations: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      let project = null;
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      for (const module of modules) {
        let config = moduleConfig ? moduleConfig.find((item)=>{
          return item._id === module._id
        }): null
        module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
        if(module.analysis){
          _.each(module.analysis.components,function (component) {
            component.moduleId = module._id;
            moduleComponents.push(component)
          });
        }
      }
      let licenses = [];
      _.each(moduleComponents, function (component) {
        _.each(component.versions, function (version) {
          _.each(version.paths, function (path) {
            collectLicensesFromPath(path, component, projectId, moduleIds, licenses);
          });
        });
      });
      let obligations = [];
      licenses = _.each(_.filter(licenses,
        function (license) {
          return license && license.status && (license.status.obligations || license.status.deadlyObligations)
        }),
      function (license) {
        license.obligations = license.status.obligations && license.status.obligations.split('; ');
        _.each(license.obligations, function (obligation) {
          let subItem = {
            key: obligation,
            component: license.component
          };
          obligations.push(subItem)
        });
        license.deadlyObligations = license.status.deadlyObligations && license.status.deadlyObligations.split('; ');
        _.each(license.deadlyObligations, function (obligation) {
          let subItem = {
            key: obligation,
            component: license.component
          };
          obligations.push(subItem)
        });
      });
      obligations = _.sortBy(_.map(_.groupBy(obligations,function (obligation) {
        return obligation.key
      }), function (val, key) {
        return {
          key: key,
          components: _.map(val,function (component) {
            return component.component
          }),
          count: val.length
        }
      }), 'count').reverse();
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list : obligations,
        modules: modulesMap,
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        }
      };
    }
  },
   
  getProjectLicenses: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      const company = companyId ? await Companies.findOneAsync(companyId) : null;
      const project = projectId ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS}) : null;
      let moduleLicenses = [];
      for (const module of modules) {
        let config = moduleConfig ? moduleConfig.find((item)=>{
          return item._id === module._id
        }): null
        module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
        if (module.analysis && (module.analysis.licenses || module.analysis[0])){
          let licenses = module.analysis.licenses || module.analysis[0].licenses;
          licenses = _.map(licenses, function (license) {
            license.moduleId = module._id;
            return license
          });
          moduleLicenses.push(licenses);
        }
      }
      let uniqueLicenses = _.groupBy(_.flatten(moduleLicenses), function (license) {
        return license && license.key
      });
      let countComponents = 0;
      let countObligations = [];
      let countViolations = 0;
      let countWarnings = 0;
      let uniqueLicensesUpd = _.map(uniqueLicenses, function (array, key) {
        let license = {
          key: key,
          countModules: array.length,
          modules: _.map(array, function (elem) {
            return elem.moduleId
          }),
          statusByModule: [],
          components: [],
          name: array[0].name,
          status: 'ok',
          label: 'OK'
        };
        let isWarning = _.any(array, function (item) {
          return item.status === 'warnings'
        });
        if (isWarning) {
          license.status = 'warnings';
          license.label = 'Warnings'
        }
        let isViolations = _.any(array, function (item) {
          return item.status === 'violations'
        });
        if (isViolations) {
          license.status = 'violations';
          license.label = 'Violations'
        }
        license.statusByModule = _.map(license.modules, function (elem) {
          let moduleItem = _.find(modules, function (moduleItem) {
            return moduleItem._id === elem
          });
          let newLicenseItem = Utils.updateLicenseStatus(moduleItem, project, company, new License(license));
          newLicenseItem.module = moduleItem;
          let {_id, name} = moduleItem;
          let {status, label} = newLicenseItem;
          return {status, label, module: {_id, name}}
        });
        let isBlacklisted = _.find(license.statusByModule, function (item) {
          return item.label.indexOf('Blacklisted') > -1
        });
        if (isBlacklisted) {
          license.status = 'violations';
          if (isBlacklisted.label.indexOf('module') > -1) {
            license.label = 'Blacklisted in "' + isBlacklisted.module.name + '"'
          } else {
            license.label = isBlacklisted.label;
          }
        }
        let isWhitelisted = _.find(license.statusByModule, function (item) {
          return item.label.indexOf('Whitelisted') > -1
        });
        if (isWhitelisted) {
          license.status = 'ok';
          if (isWhitelisted.label.indexOf('module') > -1) {
            license.label = 'Whitelisted in "' + isWhitelisted.module.name + '"'
          } else {
            license.label = isWhitelisted.label;
          }
        }
        license.components = _.uniq(_.flatten(_.map(array, function (item) {
          return item.components
        })), function (comp){
          return comp.componentKey + comp.version
        });
        countComponents += license.components.length;
        countObligations.push(_.uniq(_.flatten(_.map(_.filter(license.components, function (component) {
          return component.status && component.status.obligations
        }), function (component) {
          return component.status.obligations.split('; ') || component.status.obligations
        }))));
        countObligations.push(_.uniq(_.flatten(_.map(_.filter(license.components, function (component) {
          return component.status && component.status.deadlyObligations
        }), function (component) {
          return component.status.deadlyObligations.split('; ') || component.status.deadlyObligations
        }))));
        license.obligations = _.uniq(_.flatten(_.map(_.filter(license.components, function (component) {
          return component.status && component.status.obligations
        }),function (component) {
          return component.status && (component.status.obligations.split('; ') || component.status.obligations)
        })));
        license.violations = _.uniq(_.flatten(_.map(_.filter(license.components, function (component) {
          return component.status && component.status.violations
        }),function (component) {
          return component.status && (component.status.violations.split('; ') || component.status.violations)
        })));
        license.deadlyObligations = _.uniq(_.flatten(_.map(_.filter(license.components, function (component) {
          return component.status && component.status.deadlyObligations
        }),function (component) {
          return component.status && (component.status.deadlyObligations.split('; ') || component.status.deadlyObligations)
        })));
        license.components = license.components.length;
        if(company && company.privateLicenses){
          license.privateLicense =_.any(company.privateLicenses, function (privateLicenseItem) {
            return privateLicenseItem.key === license.key
          });
          if(license.privateLicense){
            license.status = 'ok';
            license.label = 'Private license';
          }
        }
        if(license.status !== 'ok'){
          if(license.status === 'violations'){
            countViolations += license.components
          }else {
            countWarnings += license.components
          }
        }
        return license
      });
      uniqueLicensesUpd = _.sortBy(uniqueLicensesUpd, function (item) {
        return item && item.components
      }).reverse();
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list: uniqueLicensesUpd,
        stats: {
          components: countComponents,
          componentViolations: countViolations,
          componentWarnings: countWarnings,
          licenses: uniqueLicensesUpd.length,
          obligations: _.uniq(_.flatten(countObligations)).length
        },
        modules: modulesMap,
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        }
      }
    }
  },
   
  // Both methods are now thin wrappers. The computation lives in
  // imports/lib/interactors/projects/vulnerabilityLive.js so the
  // vulnerability-alert sweep can run it with no DDP user, so the per-component
  // `cves` query became one batched lookup per 100 keys, and so the CVE-level
  // release difference exists in exactly one place.
  getProjectVulnerabilityDifference: async function (approve) {
    // projectScopedCompanyId answers `undefined` for a session whose user has no
    // profile.companyId, and the whole `approve` argument is client-supplied -
    // so a DDP caller gets 403 rather than a company read out of that document.
    //
    // A SERVER-INTERNAL call has no user to resolve from at all, and the public
    // VEX "changes" artefact is generated that way for releases whose optional
    // `companyId` is absent. Only in that case is the tenant read from the
    // release's own project - a stored document.
    const scoped = await projectScopedCompanyId(approve && approve.companyId);
    const companyId = await resolveDifferenceCompanyId(approve, scoped, !this.connection);
    if (typeof companyId !== 'string' || !companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await computeVulnerabilityDifference(approve, companyId);
  },
   
  getProjectVulnerabilityLive: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (typeof companyId !== 'string' || !companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await computeProjectVulnerabilityLive({projectId, companyId, moduleIds, moduleConfig});
  },
   
  getProjectVulnerability: async function (projectId, companyId, moduleIds, moduleConfig, minConfidence) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        if(project){
          query.projectId = projectId;
        }
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const company = await Companies.findOneAsync(companyId);
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          componentsList = _.map(componentsList, function (component) {
            component.moduleName = module.name;
            component.module = module;
            component.environmentalConfig = module.environmentalConfig;
            return component;
          });
          moduleComponents.push(componentsList)
        }
      }
      let allComponents = _.flatten(moduleComponents);
      moduleComponents = _.filter(allComponents, function (component) {
        return component.problems && component.problems.vulnerability && component.problems.vulnerability.length
      });
      let vulnerabilityKeys = [];
      let mutedVulnerability= {};
      moduleComponents = _.map(moduleComponents, function (component) {
        let newComponent = component;
        newComponent.problems.vulnerability = _.map(component.problems.vulnerability, function (vulnerability) {
          let newVulnerability = vulnerability;
          if(vulnerability.message){
            newVulnerability.key =  vulnerability.message.split(': ')[0];
            // Upstream `extra.isWhitelisted` is a boolean from the scan layer. Replace it with the
            // actual whitelist entry (carrying `comment` = mute reason) so downstream CSAF generation
            // can map the reason to a VEX status. Falls back to the original boolean if no entry found.
            const wlEntry = isCveWhitelisted(newVulnerability.key, component.key,
              null, company, project, component.module)
            newVulnerability.isWhitelisted = (wlEntry && wlEntry.comment)
              ? wlEntry
              : (vulnerability.extra && vulnerability.extra.isWhitelisted)
          }
          return newVulnerability
        });
        return newComponent
      });
      // Attach a floored EPSS score to every vulnerability BEFORE the
      // confidence filter further down narrows moduleComponents. The REST/JSON
      // export (imports/server/rest-api/reports.js) is the caller that passes
      // a real `minConfidence`, so this batched lookup must cover every CVE
      // in the module, not just whatever survives that later filter.
      let epssCveIds = [];
      for (const component of moduleComponents) {
        for (const vulnerability of component.problems.vulnerability) {
          if (vulnerability.key) {
            epssCveIds.push(vulnerability.key);
          }
        }
      }
      const epssMap = await tsEpssScores(_.uniq(epssCveIds));
      for (const component of moduleComponents) {
        for (const vulnerability of component.problems.vulnerability) {
          vulnerability.extra = vulnerability.extra || {};
          vulnerability.extra.epss = resolveEpss(vulnerability.key, epssMap);
        }
      }
      moduleComponents = _.groupBy(moduleComponents, function (component) {
        return component.key
      });
      moduleComponents = _.map(moduleComponents, function (componentList) {
        let newComponent = {
          key: componentList[0].key
        };
        let versions = [];
        let problems = [];
        _.each(componentList, function (component) {
          _.each(component.problems.vulnerability, function (vulnerability) {
            if(!minConfidence || !vulnerability.extra.confidence ||
              (vulnerability.extra.confidence && minConfidence &&
                confidenceMap(minConfidence) >= vulnerability.extra.confidence)){
              vulnerabilityKeys.push(vulnerability.key);
              if(!mutedVulnerability[vulnerability.key]){
                mutedVulnerability[vulnerability.key] = []
              }
              mutedVulnerability[vulnerability.key].push(vulnerability.isWhitelisted)
              versions.push(vulnerability.version);
              problems.push(vulnerability);
            }
          });
        });
        newComponent.versions = _.map(SemverExt.arraySortByVersion(_.map(_.unique(_.flatten(versions)),
          (version)=> {return {version}})),(version)=> {return version.version});
        newComponent.problems = {
          vulnerability: _.groupBy(_.flatten(problems), function (vulnerability) {
            return vulnerability.key
          })
        };
        newComponent.problems.vulnerability = _.map(newComponent.problems.vulnerability,(vulnerabilities)=>{
          let {status, message, extra, key} = vulnerabilities[0]
          // Prefer an entry whose isWhitelisted is the full whitelist object (carries `comment`),
          // falling back to any truthy isWhitelisted (boolean) so existing UI behaviour is preserved.
          let withComment = _.find(vulnerabilities, (item) => item.isWhitelisted && item.isWhitelisted.comment)
          let anyTruthy = _.find(vulnerabilities, (item) => item.isWhitelisted)
          let isWhitelisted = (withComment && withComment.isWhitelisted)
            || (anyTruthy && anyTruthy.isWhitelisted)
          let newVulnerability = {status, message, extra, key, isWhitelisted};
          newVulnerability.version = _.map(SemverExt.arraySortByVersion(_.map(_.unique(_.flatten(
            _.map(vulnerabilities,(vuln)=>vuln.version))),
          (version)=> {return {version}})),(version)=> {return version.version});
          return newVulnerability
        })
        newComponent.problems.vulnerability = _.sortBy(newComponent.problems.vulnerability,function (vulnerability) {
          return Math.floor(+vulnerability.extra.score);
        }).reverse();
        newComponent.countPath = collectPathsFromComponentList(componentList, newComponent);
        return newComponent;
      });
      if(minConfidence){
        moduleComponents = _.filter(moduleComponents, function (component) {
          return component.problems && component.problems.vulnerability && component.problems.vulnerability.length
        });
      }
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, description, analysis, properties, _id, projectId, version, cveConfig,
            confidenceMinScore, environmentalConfig} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            description,
            projectId,
            cveConfig,
            confidenceMinScore,
            environmentalConfig,
            properties,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      mutedVulnerability = _.filter(Object.keys(mutedVulnerability), (key) => {
        return _.some(mutedVulnerability[key], (item) =>{
          return item && item.key
        })
      })
      const {name, _id} = company;
      return {
        list: moduleComponents || [],
        stats: {
          componentsTotal: allComponents.length,
          components: moduleComponents.length,
          modules: modules.length,
          vulnerability: _.uniq(vulnerabilityKeys).length,
          mutedVulnerability: mutedVulnerability.length
        },
        modules: modulesMap,
        project : project,
        company : {name, _id}
      }
    }
  },
   
  getProjectViability: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let components = await module.getAllComponentsAsync(null, analysisId) || [];
          let resolvedComponents = [];
          for (const projComp of components) {
            let component;
            if(projComp.key.indexOf('im:') === 0){
              component = await InfrastructureComponents.findOneAsync({key: projComp.key}, {fields: {logs: 0, 'crawlerInfo.npm-releases': 0,
                'crawlerInfo.mavencentral-releases': 0, 'crawlerInfo.nist': 0, 'crawlerInfo.nuget-releases': 0,
                'crawlerInfo.maven2-versions': 0}});
            }else{
              component = await Components.findOneAsync({$or:[{key: projComp.key}, {oldKey: projComp.key}]},
                {fields: {logs: 0, 'crawlerInfo.npm-releases': 0,
                  'crawlerInfo.mavencentral-releases': 0, 'crawlerInfo.nist': 0, 'crawlerInfo.nuget-releases': 0,
                  'crawlerInfo.maven2-versions': 0}});
            }
            if (component) {
              const data = component.data();
              const usedVersions = _.map(projComp.versions, c => c.version);
              if (data.versions) {
                data.versions = _.filter(data.versions, function (v) {
                  return usedVersions.indexOf(v.version) > -1;
                });
              }

              projComp.versions.forEach(function (v) {
                const version = component.findVersion(v.version);
                if (version) {
                  version.data().paths = v.paths;
                }
              });
              resolvedComponents.push(new Component(data));
            }
          }
          components = _.compact(resolvedComponents);
          moduleComponents.push(components)
        }
      }
      moduleComponents = _.sortBy(_.groupBy(_.flatten(moduleComponents), function (component) {
        return component.getKey();
      }), function (component) {
        return component[0].getViability().starsCnt
      });
      let componentsWithoutViability = _.filter(moduleComponents, function (component) {
        return component[0].getViability().error
      });
      moduleComponents = _.map(moduleComponents, function (component) {
        let newComponent = component[0].data();
        newComponent.counter = component.length;
        return newComponent;
      });
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list: moduleComponents,
        stats: {
          components: moduleComponents.length,
          modules: modules.length,
          withoutViability: componentsWithoutViability.length
        },
        modules: modulesMap,
        project : project
      }
    }
  },
  getProjectVersioning: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          componentsList = _.map(componentsList, function (component) {
            component.moduleName = module.name;
            component.module = module;
            return component;
          });
          moduleComponents.push(componentsList)
        }
      }
      let allComponents = _.flatten(moduleComponents);
      moduleComponents = _.filter(allComponents, function (component) {
        return component.problems && component.problems.versioning && component.problems.versioning.length
      });
      moduleComponents = _.groupBy(moduleComponents, function (component) {
        return component.key
      });
      let statuses = {
        violations: 0,
        warnings: 0
      }
      moduleComponents = _.sortBy(_.map(moduleComponents, function (componentList) {
        let newComponent = {
          key: componentList[0].key
        };
        let versions = [];
        let problems = [];
        _.each(componentList, function (component) {
          _.each(component.problems.versioning, function (versioning) {
            versions.push(versioning.version);
            problems.push(versioning);
          });
        });
        newComponent.versions = _.unique(_.flatten(versions)).join(', ');
        newComponent.problems = _.unique(problems, function (problem) {
          return problem.message
        });
        if(_.some(newComponent.problems, function (problem) {
          return problem.status === 'violations'
        })){
          newComponent.status = 'violations'
          statuses.violations = statuses.violations + 1;
        } else if(_.some(newComponent.problems, function (problem) {
          return problem.status === 'warnings'
        })){
          newComponent.status = 'warnings'
          statuses.warnings = statuses.warnings + 1;
        } else{
          newComponent.status = 'ok'
        }
        newComponent.countPath = collectPathsFromComponentList(componentList, newComponent);
        return newComponent;
      }), function (component) {
        return component.status
      });
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list: moduleComponents || [],
        stats: {
          componentsTotal: allComponents.length,
          components: moduleComponents.length,
          modules: modules.length,
          warnings: statuses.warnings,
          violations: statuses.violations,
          totalProblems: statuses.warnings + statuses.violations
        },
        modules: modulesMap,
        project : project
      }
    }
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  getProjectModification: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          componentsList = _.map(componentsList, function (component) {
            component.moduleName = module.name;
            component.module = module;
            return component;
          });
          moduleComponents.push(componentsList)
        }
      }
      let allComponents = _.flatten(moduleComponents);
      moduleComponents = _.groupBy(allComponents, function (component) {
        return component.key
      });
      let modified = 0;
      let undocumentedChanges = 0;
      let mappedComponents = [];
      for (const componentList of Object.values(moduleComponents)) {
        let newComponent = {
          key: componentList[0].key
        };
        let counter = 0;
        newComponent.paths = [];
        if(componentList){
          for (const comp of componentList) {
            if(comp && comp.versions){
              newComponent.versions = []
              for (const ver of comp.versions) {
                if(ver && ver.paths){
                  for (const path of ver.paths) {
                    if(!isUnchanged(comp.module, comp.key, '*', null)){
                      const location = pathLocation(path);
                      let pathObject = {
                        path: pathLabel(comp.moduleName, path),
                        paths: location ? [location] : [],
                        version: ver.version,
                        moduleId: comp.module._id,
                        componentKey: newComponent.key,
                        unchanged: !!isUnchanged(comp.module, comp.key, ver.version, location)
                      };
                      newComponent.versions.push(pathObject.version)
                      const changesUrl = await ComponentModifications.findOneAsync({
                        'component.key': newComponent.key,
                        'component.version': pathObject.version,
                        'moduleId': comp.module._id,
                        companyId,
                        'type': 'changesUrl'
                      }, {sort: {created: -1}, limit: 1})
                      const changesText = await ComponentModifications.findOneAsync({
                        'component.key': newComponent.key,
                        'component.version': pathObject.version,
                        'moduleId': comp.module._id,
                        companyId,
                        'type': 'changesText'
                      }, {sort: {created: -1}, limit: 1})
                      pathObject.changesUrl = changesUrl && changesUrl.value;
                      pathObject.changesText = changesText && changesText.value;
                      if(!pathObject.changesUrl && !pathObject.changesText){
                        undocumentedChanges++
                      }
                      counter++
                      newComponent.paths.push(pathObject);
                    }
                  }
                }
              }
            }
          }
        }
        newComponent.versions = _.unique(newComponent.versions).join(', ')
        newComponent.countPath = counter;
        modified += counter;
        mappedComponents.push(newComponent);
      }
      moduleComponents = _.filter(_.sortBy(mappedComponents, function (component) {
        return component.status
      }), function (component) {
        return component.countPath > 0
      });
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list: moduleComponents || [],
        stats: {
          componentsTotal: allComponents.length,
          modules: modules.length,
          modified: modified,
          undocumentedChanges: undocumentedChanges
        },
        modules: modulesMap,
        project : project
      }
    }
  },
  // eslint-disable-next-line no-unused-vars
  getProjectExportControl: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: {name: 1, companyId: 1, description: 1, algorithmsConfig: 1}});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const company = await Companies.findOneAsync(companyId);
      const modules = await Modules.find(query).fetchAsync();
      let moduleList = [];
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version, algorithmsConfig} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          if(algorithmsConfig && algorithmsConfig.length){
            moduleList = moduleList.concat(algorithmsConfig);
          }
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      let projectList = [];
      let companyList = [];
      if (project) {
        projectList = project.algorithmsConfig || [];
      }
      if (company) {
        companyList = company.algorithmsConfig || [];
      }
      projectList.map(function (elem) {
        elem.projectItem = true;
        return elem
      });
      companyList.map(function (elem) {
        elem.companyItem = true;
        return elem
      });
      const settings = _.sortBy(companyList.concat(projectList.concat(moduleList)),'key')
      const algorithms = await Meteor.callAsync('getProjectAlgorithmsShort', project._id, companyId)
      return {
        list: settings || [],
        algorithms,
        stats: {
          modules: modules.length
        },
        modules: modulesMap,
        project : project
      }
    }
  },
   
  getProjectAlgorithms: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId},
          {fields: {name: 1, companyId: 1, description: 1, algorithmsConfig: 1, relatedUsers: 1}});
        if(project){
          query.projectId = projectId;
        }
      }
      if(moduleIds && moduleIds.length){
        query._id = { $in : moduleIds}
      }
      const company = await Companies.findOneAsync(companyId);
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      let algorithms = []
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          _.forEach(componentsList, function (projComp) {
            if (projComp.crypto_algorithms && projComp.crypto_algorithms.length) {
              projComp.moduleName = module.name;
              projComp.moduleId = module._id;
              let {key, crypto_algorithms, moduleName, moduleId} = projComp
              moduleComponents.push({key, crypto_algorithms, moduleName, moduleId})
              algorithms.push(crypto_algorithms)
            }
          });
        }
      }
      algorithms = _.sortBy(_.uniq(_.flatten(algorithms), 'algorithm'), 'algorithm');
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, description, analysis, properties, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            description,
            projectId,
            properties,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      const {name, _id} = company;
      return {
        list: moduleComponents || [],
        crypto_algorithms: algorithms || [],
        stats: {
          componentWithAlgorithms: moduleComponents.length,
          modules: modules.length
        },
        modules: modulesMap,
        project : project,
        company : {name, _id}
      }
    }
  },
  getProjectAlgorithmsShort: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project = {};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        if(project){
          query.projectId = projectId;
        }
      }
      if(moduleIds && moduleIds.length){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      let algorithms = []
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          _.forEach(componentsList, function (projComp) {
            if (projComp.crypto_algorithms && projComp.crypto_algorithms.length) {
              algorithms.push(projComp.crypto_algorithms)
            }
          });
        }
      }
      algorithms = _.sortBy(_.uniq(_.flatten(algorithms), 'algorithm'), 'algorithm');
      return algorithms
    }
  },
  getProjectAiModels: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId},
          {fields: {name: 1, companyId: 1, description: 1, relatedUsers: 1}});
        if(project){
          query.projectId = projectId;
        }
      }
      if(moduleIds && moduleIds.length){
        query._id = { $in : moduleIds}
      }
      const company = await Companies.findOneAsync(companyId);
      const modules = await Modules.find(query).fetchAsync();
      let moduleComponents = [];
      let aiModels = []
      for (const module of modules) {
        if (module) {
          let config = moduleConfig ? moduleConfig.find((item)=>{
            return item._id === module._id
          }): null
          module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
          const analysisId = module.analysis && module.analysis._id;
          let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
          _.forEach(componentsList, function (projComp) {
            if (projComp.ai_models && projComp.ai_models.length) {
              projComp.moduleName = module.name;
              projComp.moduleId = module._id;
              let {key, ai_models, moduleName, moduleId} = projComp
              moduleComponents.push({key, ai_models, moduleName, moduleId})
              aiModels.push(ai_models)
            }
          });
        }
      }
      aiModels = _.sortBy(_.uniq(_.flatten(aiModels), false, (item) => {
        return (item.purl || item.name || '') + (item.version || '')
      }), 'name');
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, description, analysis, properties, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            description,
            projectId,
            properties,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      const {name, _id} = company;
      return {
        list: moduleComponents || [],
        ai_models: aiModels || [],
        stats: {
          componentWithModels: moduleComponents.length,
          modules: modules.length
        },
        modules: modulesMap,
        project : project,
        company : {name, _id}
      }
    }
  },
  getProjectBadAlgorithms: async function (projectId, companyId, apiUser) {
    companyId = await projectScopedCompanyId(companyId);
    async function byProject(projectId){
      if (projectId) {
        let detectedAlgorithms = await Meteor.callAsync('CryptoAlgorithms.Find', {projectId, apiUser});
        let detectedKeys = detectedAlgorithms.crypto_algorithms && detectedAlgorithms.crypto_algorithms.map(item => {
          return item.algorithm;
        }) || []
        let managedAlgorithms = await Meteor.callAsync(CP_FIND, {projectId, apiUser});
        let managedKeys = managedAlgorithms.map(item => {
          return item.name;
        })
        let managedInUse = managedAlgorithms.filter(item => {
          return item.used;
        }).map(item => {
          return item.name;
        })
        let inUseList = detectedKeys.filter((item)=>{
          return !_.some(managedKeys, (elem)=>{
            return elem.toLowerCase() === item.toLowerCase();
          })
        }).concat(managedInUse);
        return {
          list: [{
            project: detectedAlgorithms.project,
            modules: detectedAlgorithms.modules,
            algorithms: inUseList
          }],
          stats: {
            componentWithAlgorithms: detectedAlgorithms.stats && detectedAlgorithms.stats.componentWithAlgorithms || 0,
            projects: 1,
            modules: detectedAlgorithms.stats && detectedAlgorithms.stats.componentWithAlgorithms || 0,
            detectedAlgorithms: detectedKeys.length,
            managedAlgorithms: managedKeys.length,
            inUseAlgorithms: inUseList.length,
            managedInUseAlgorithms: managedInUse.length,
            coverage: ((managedInUse.length/inUseList.length*100)||0).toFixed(2)
          },
          company : detectedAlgorithms.company
        }
      }
    }
    if(projectId)
      return await byProject(projectId);
    const user = await Meteor.userAsync();
    if((!user || user && user.profile && (user.profile.companyId === companyId)) && companyId){
      const projects = await Projects.find({companyId}, {fields: { name : 1 }}).fetchAsync();
      const overall = {
        list: [],
        stats: {
          componentWithAlgorithms: 0,
          modules: 0,
          detectedAlgorithms: 0,
          managedAlgorithms: 0,
          inUseAlgorithms: 0,
          managedInUseAlgorithms: 0,
          coverage: 0
        },
        company : null
      }
      await Promise.all(projects.map(async (project) => {
        let byProjectData = await byProject(project._id)
        if(!overall.company){
          overall.company = byProjectData.company
        }
        if(byProjectData && byProjectData.stats.inUseAlgorithms > 0){
          overall.list.push(byProjectData.list[0])
          overall.stats.componentWithAlgorithms += byProjectData.stats.componentWithAlgorithms
          overall.stats.modules += byProjectData.stats.modules
          overall.stats.detectedAlgorithms += byProjectData.stats.detectedAlgorithms
          overall.stats.managedAlgorithms += byProjectData.stats.managedAlgorithms
          overall.stats.inUseAlgorithms += byProjectData.stats.inUseAlgorithms
          overall.stats.managedInUseAlgorithms += byProjectData.stats.managedInUseAlgorithms
        }
      }));
      overall.stats.coverage = ((overall.stats.managedInUseAlgorithms/overall.stats.inUseAlgorithms*100)||0).toFixed(2)
      return overall
    }
  },
  getProjectEndoflife: async function (projectId, companyId) {
    companyId = await projectScopedCompanyId(companyId);
    async function byProject(projectId){
      if (projectId) {
        const query = {companyId};
        let project;
        const company = await Companies.findOneAsync(companyId);
        if (projectId === Projects.UNASSIGNED) {
          query.projectId = {$exists: false};
          project = {
            name:UNASSIGNED,
            _id: Projects.UNASSIGNED
          };
        } else {
          project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: {name: 1, description: 1, endoflifeConfig: 1}});
          query.projectId = projectId;
        }
        const modules = await Modules.find(query).fetchAsync();
        let moduleComponents = [];
        for (const module of modules) {
          if (module) {
            module.analysis = await module.getAnalysisAsync(null, null);
            const analysisId = module.analysis && module.analysis._id;
            let componentsList = await module.getAllComponentsAsync(null, analysisId) || [];
            componentsList = _.map(componentsList, function (component) {
              component.moduleName = module.name;
              component.module = module;
              return component;
            });
            moduleComponents.push(componentsList)
          }
        }
        let allComponents = _.flatten(moduleComponents);
        moduleComponents = _.filter(allComponents, function (component) {
          return component.problems && component.problems.endoflife && component.problems.endoflife.length
        });
        moduleComponents = _.groupBy(moduleComponents, function (component) {
          return component.key
        });
        let statuses = {
          violations: 0,
          warnings: 0
        }
        moduleComponents = _.sortBy(_.map(moduleComponents, function (componentList) {
          let newComponent = {
            key: componentList[0].key
          };
          let versions = [];
          let problems = [];
          _.each(componentList, function (component) {
            collectEndoflifeData(component, versions, problems);
          });
          newComponent.versions = _.unique(_.flatten(versions)).join(', ');
          newComponent.problems = _.unique(problems, function (problem) {
            return problem.message
          });
          if(_.some(newComponent.problems, function (problem) {
            return problem.status === 'violations'
          })){
            newComponent.status = 'violations'
            statuses.violations = statuses.violations + 1;
          } else if(_.some(newComponent.problems, function (problem) {
            return problem.status === 'warnings'
          })){
            newComponent.status = 'warnings'
            statuses.warnings = statuses.warnings + 1;
          } else{
            newComponent.status = 'ok'
          }
          newComponent.countPath = collectPathsWithProjectFromComponentList(componentList, newComponent);
          return newComponent;
        }), function (component) {
          return component.status
        });
        const modulesMap = _.map(modules, function (module) {
          if(module){
            const {name, analysis, _id, projectId, version} = module;
            const {branch, tag, release, date} = analysis || {};
            const analysisId = analysis && analysis._id;
            return {
              _id,
              name,
              version,
              projectId,
              analysis: {branch, tag, release, date, _id: analysisId}
            }
          }
        });
        const {name, _id} = company;
        return {
          list: moduleComponents || [],
          stats: {
            componentsTotal: allComponents.length,
            components: moduleComponents.length,
            modules: modules.length,
            warnings: statuses.warnings,
            violations: statuses.violations,
            totalProblems: statuses.warnings + statuses.violations
          },
          modules: modulesMap,
          project : project,
          company : {name, _id}
        }
      }
    }
    if(projectId)
      return await byProject(projectId);
    const user = await Meteor.userAsync();
    if((!user || user && user.profile && (user.profile.companyId === companyId)) && companyId){
      const projects = await Projects.find({companyId}, {fields: { name : 1 }}).fetchAsync();
      const overall = {
        list: [],
        stats: {
          componentsTotal: 0,
          components: 0,
          modules: 0,
          warnings: 0,
          violations: 0,
          totalProblems: 0
        },
        company : null,
        projects : []
      }
      await Promise.all(projects.map(async (project) => {
        let byProjectData = await byProject(project._id)
        if(!overall.company){
          overall.company = byProjectData.company
        }
        if(byProjectData && byProjectData.stats){
          if(byProjectData.list.length){
            overall.list.push(byProjectData.list)
            let {_id, name, description} = byProjectData.project
            overall.projects.push({_id, name, description})
          }
          overall.stats.componentsTotal += byProjectData.stats.componentsTotal
          overall.stats.modules += byProjectData.stats.modules
        }
      }));
      overall.list = groupByKey(_.flatten(overall.list))
      overall.stats.components = overall.list.length
      overall.stats.warnings = overall.list.filter(item => item.status === 'warnings').length
      overall.stats.violations = overall.list.filter(item => item.status === 'violations').length
      overall.stats.totalProblems = overall.stats.warnings + overall.stats.violations
      return overall
    }
  },
  // eslint-disable-next-line no-unused-vars, sonarjs/cognitive-complexity
  getProjectTests: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      let project;
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
        project = {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        };
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query, {fields:{name:1, projectId:1, version:1, quality:1}}).fetchAsync();
      let testsList = [];
      let statsList = {};
      let total = 0;
      let ok = 0;
      let warnings = 0;
      let violations = 0;
      let totalByRules = 0;
      let notesByRules = 0;
      let warningsByRules = 0;
      let violationsByRules = 0;
      const modulesMap = [];
      for (const module of modules) {
        if(module){
          const {name, _id, projectId, version, quality} = module;
          statsList[_id] = quality
          const qualityData = module.getQuality();
          const scanId = quality && quality.scanId
          if(qualityData){
            ok += qualityData.ok ? qualityData.ok : 0;
            warnings += qualityData.warnings ? qualityData.warnings : 0;
            violations += qualityData.violations ? qualityData.violations : 0;
            total += (qualityData.ok ? qualityData.ok : 0) + (qualityData.warnings ? qualityData.warnings : 0) +
              (qualityData.violations ? qualityData.violations : 0);
          }
          let testFilter = {$and:[{companyId, moduleId: _id}]}
          if(scanId){
            testFilter.$and.push({$or:[{scanId},{scanId: {$exists: false}}]});
            const scan = await Scans.findOneAsync(scanId, {fields: {submitted: 1}});
            if(scan){
              testFilter.$and.push({submitted: {$gte: new Date(scan.submitted)}});
            }
          }
          let tests = await Tests.find(testFilter, {fields: {data: 0}}).fetchAsync();
          if(tests && tests.length){
            tests = tests.map((test)=>{
              test.moduleName = name;
              test.moduleId = _id;
              if(test.rules){
                totalByRules += test.rules.total;
                notesByRules += test.rules.notes;
                warningsByRules += test.rules.warnings;
                violationsByRules += test.rules.violations;
              }
              return test
            })
            testsList = testsList.concat(tests);
          }
          modulesMap.push({
            _id,
            name,
            version,
            projectId
          });
        }
      }
      const settings = _.sortBy(testsList,'submitted').reverse()
      return {
        list: settings || [],
        moduleStats: statsList,
        stats: {
          modules: modules.length,
          ok,
          warnings,
          violations,
          total
        },
        statsByRules: {
          notes: notesByRules,
          warnings: warningsByRules,
          violations: violationsByRules,
          total: totalByRules
        },
        modules: modulesMap,
        project : project
      }
    }
  },
  getProjectCapabilities: async function (projectId, companyId, moduleIds, moduleConfig) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = { $in : moduleIds}
      }
      const modules = await Modules.find(query).fetchAsync();
      const project = projectId ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS}) : null;
      let moduleCapabilities = [];
      for (const module of modules) {
        let config = moduleConfig ? moduleConfig.find((item)=>{
          return item._id === module._id
        }): null
        module.analysis = await module.getAnalysisAsync(null, config && config.analysisId);
        if (module.analysis && (module.analysis.licenses || module.analysis[0])){
          let capabilities = (module.analysis && module.analysis.capabilities) ||
            (module.analysis[0] && module.analysis[0].capabilities) || [];
          capabilities = _.map(capabilities, function (license) {
            license.moduleId = module._id;
            return license
          });
          moduleCapabilities.push(capabilities);
        }
      }
      moduleCapabilities = _.flatten(moduleCapabilities)
      const modulesMap = _.map(modules, function (module) {
        if(module){
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          return {
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          }
        }
      });
      return {
        list: moduleCapabilities,
        stats: {
          capabilities: moduleCapabilities.length
        },
        modules: modulesMap,
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        }
      }
    }
  },
  generateDemoData: async function () {
    const user = await requireDemoDataUser();
    // One demo project per company: a second click (or a scripted loop) would otherwise
    // add another project and another analysis each time. Reported rather than silent,
    // so the client does not announce a demo that was not created by this call.
    if (await Projects.findOneAsync({companyId: user.profile.companyId, demo: true}, {fields: {_id: 1}})) {
      return {existing: true};
    }
    let projectBase = await Meteor.callAsync('setRelatedUsers', user._id, {
      name: 'Demo project',
      companyId: user.profile.companyId,
      creationDate: new Date(),
      demo: true,
      requirements: {
        'CA' : 'CA_license',
        'OM' : 'OM_mop',
        'IP_protect' : 'IP_protect_n',
        'IP_enforce' : 'IP_enforce_3'
      }
    });
    try {
      const data = await Projects.insertAsync(projectBase);
      let module = new Module(user.profile.companyId, 'Demo module', Utils.generateModuleIdentifier('Demo module'));
      module.viabilityConfig = {
        'warningThreshold': 1,
        'violationThreshold': 1,
        'minConfidence': 1,
        'noInfoLevel': 1
      };
      let scanId = Random.id();
      module.componentConfig = {
        'looseCoupled': [],
        'unchanged': [],
        'whitelist': [],
        'blacklist': []
      };
      module.projectId = data;
      module.properties = {
        'privacy': 'opensource',
        'architecture': 'sourceCode'
      };
      module.requirements = {
        'TS' : 'TS_y',
        'LS' : 'LS_pl',
        'D' : 'D_ipoa'
      };
      module.demo = true;
      const currentUser = await Meteor.userAsync();
      module = await Meteor.callAsync('setModuleRelatedUsers', currentUser._id, module);
      try {
        const moduleData = await Modules.insertAsync(module);
        const user2 = await Meteor.userAsync();
        await Meteor.callAsync('logEvent', user2, 'New module '+module.name+' created', 'moduleCreated');
        // No canned analysis: the processScan run deferred below writes the real one, and a
        // canned copy would show up next to it in the module's analysis history.
        try {
          await Meteor.callAsync('updateCompanyStatistics', user2.profile.companyId);
        } catch(error) {
          console.log('Error updateCompanyStatistics', error);
        }
        let scan = DemoData.getDemoScan(scanId, moduleData, user2);
        // processScan resolves the module by projectId + moduleIdentifier, so the scan must
        // carry the ones of the module created above or it would create a second module.
        scan.projectId = data;
        scan.moduleIdentifier = module.moduleIdentifier;
        try {
          await Scans.insertAsync(scan);
          const user3 = await Meteor.userAsync();
          await Meteor.callAsync('logEvent', user3, 'New scan '+scan._id+' created for '+scan.module, 'scanCreated');
          // Same path as an uploaded scan: processScan writes the dependencies into the
          // component catalogue (without them the analysis finds no component and every
          // license is "unknown") and then analyses the module. Deferred so the method
          // returns as soon as the demo data is stored.
          const companyId = user3.profile.companyId;
          Meteor.defer(async function () {
            try {
              await processScan(scanId, user3, companyId, true);
            } catch (err) {
              console.error('processScan error: ', err);
            }
          });
        } catch(error) {
          console.log('Error Scans.insert', error);
          const user3 = await Meteor.userAsync();
          const message = 'Error: ' + (error.reason || ' could not create scan');
          await Meteor.callAsync('logEvent', user3, message, 'scanCreated');
        }
      } catch(error) {
        const message = 'Error: ' + (error.reason || ' could not create module');
        await Meteor.callAsync('logEvent', user, message, 'moduleCreated');
      }
    } catch(error) {
      const message = 'Error: ' + (error.reason || ' could not create project');
      await Meteor.callAsync('logEvent', user, message, 'projectCreated');
    }
  },
  removeDemoData: async function () {
    const user = await requireDemoDataUser();
    const companyId = user.profile.companyId;
    let counter = 0
    try {
      const data = await Scans.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
      await Meteor.callAsync('logEvent', user, 'Demo scans deleted', 'scanDeleted');
    } catch(error) {
      const message = IE + (error.reason || ' could not delete scans');
      await Meteor.callAsync('logEvent', user, message, 'scanDeleted');
    }
    try {
      const data = await Tests.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error Tests.remove', error);
    }
    try {
      const data = await ModuleAnalysis.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error ModuleAnalysis.remove', error);
    }
    try {
      const data = await ApprovalReports.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error ApprovalReports.remove', error);
    }
    try {
      const data = await Approves.removeAsync({
        companyId,
        demo: true,
        draft: {$ne: true}   // never remove the company's draft data via the demo reset
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error Approves.remove', error);
    }
    try {
      const data = await NoticeFiles.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error NoticeFiles.remove', error);
    }
    try {
      const data = await SbomFiles.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error SbomFiles.remove', error);
    }
    try {
      const data = await Products.removeAsync({
        companyId,
        demo: true,
        draft: {$ne: true}   // never remove the company's draft data via the demo reset
      });
      if(data){ counter += data }
    } catch(error) {
      console.log('Error Products.remove', error);
    }
    try {
      const data = await Modules.removeAsync({
        companyId,
        demo: true
      });
      if(data){ counter += data }
      await Meteor.callAsync('logEvent', user, 'Demo modules deleted', 'moduleDeleted');
      try {
        const data2 = await Projects.removeAsync({
          companyId,
          demo: true
        });
        if(data2){ counter += data2 }
        await Meteor.callAsync('logEvent', user, 'Demo projects deleted', 'projectDeleted');
        await Meteor.callAsync('updateCompanyStatistics', companyId);
      } catch(error) {
        const message = IE + (error.reason || ' could not deleted projects');
        await Meteor.callAsync('logEvent', user, message, 'projectDeleted');
      }
    } catch(error) {
      const message = IE + (error.reason || ' could not deleted modules');
      await Meteor.callAsync('logEvent', user, message, 'moduleDeleted');
    }
    return counter
  },
  setRelatedUsers: async function (userId, doc) {
    const currUser = await Meteor.users.findOneAsync(userId);
    if (!doc.relatedUsers) {
      doc.relatedUsers = {};
    }
    if (await Roles.userIsInRole(currUser, ['manager'], currUser.profile.companyId)) {
      doc.relatedUsers.defaultProjectManager = userId;
    } else {
      let manager = await Meteor.users.findOneAsync({['roles.' + currUser.profile.companyId]: {$in: ['manager']}});
      doc.relatedUsers.defaultProjectManager = manager ? manager._id : null;
    }
    if (await Roles.userIsInRole(currUser, ['compliance_manager'], currUser.profile.companyId)) {
      doc.relatedUsers.defaultComplianceManager = userId;
    } else {
      let compliance_manager = await Meteor.users.findOneAsync({['roles.' + currUser.profile.companyId]: {$in: ['compliance_manager']}});
      doc.relatedUsers.defaultComplianceManager = compliance_manager ? compliance_manager._id : null;
    }
    doc.relatedUsers.members = [];
    return doc
  },
  propagateRelatedUsers: async function (projectId, key, keyData) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    // `key` is appended to the `relatedUsers.` $set path; keep it a simple field
    // name (no dots/operators) so it stays confined to the relatedUsers subtree.
    if (typeof key !== 'string' || !/^[a-zA-Z]\w*$/.test(key)) {
      throw new Meteor.Error(400, 'Invalid setting');
    }
    if(projectId){
      const modules = await Modules.find({projectId, companyId},{fields:{projectId:1}}).fetchAsync();
      for (const module of modules) {
        await Modules.updateAsync(module._id,{$set:{['relatedUsers.'+key]:keyData}});
      }
      return modules.length
    }
  },
  propagateProjectSettings: async function (projectId, key, keyData) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    // `key` is a client-supplied $set field path. Restrict it to a simple
    // top-level field name so it can never rewrite ownership/identity fields
    // (e.g. companyId → move a module into another tenant), escape into other
    // subtrees via dots, or inject a Mongo operator.
    if (typeof key !== 'string' || !/^[a-zA-Z]\w*$/.test(key)
      || ['companyId', '_id', 'projectId', 'moduleIdentifier'].indexOf(key) > -1) {
      throw new Meteor.Error(400, 'Invalid setting');
    }
    if(projectId){
      const modules = await Modules.find({projectId, companyId},{fields:{projectId:1}}).fetchAsync();
      for (const module of modules) {
        await Modules.updateAsync(module._id,{$set:{[key]:keyData}});
      }
      return modules.length
    }
  },
   
  getProjectSBOM: async function (projectId, companyId, moduleId, approveId) { // eslint-disable-line sonarjs/cognitive-complexity
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      let moduleIds
      let approve
      let company
      if(companyId){
        company = await Companies.findOneAsync(companyId,{fields:{name:1,distribution:1,writtenOffer:1}})
      }
      let moduleDataMap = {}
      if(approveId){
        approve = await Approves.findOneAsync(approveId, {fields: {modules: 1}})
        if(approve){
          moduleIds = approve.modules.map((module)=>{
            moduleDataMap[module._id] = module.scanId
            return module._id
          })
        }
      }
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      if(moduleIds){
        query._id = {$in:moduleIds};
      }else if(moduleId) {
        query._id = moduleId;
      }
      // TODO add manual components
      const modules = await Modules.find(query,{fields:{name:1,moduleIdentifier:1,projectId:1,companyId:1,
        properties:1,version:1,statistics:1,customComponents:1}}).fetchAsync();
      let moduleItem;
      const project = projectId
        ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: {name: 1, description: 1, version: 1, companyId: 1}})
        : null;
      let scansOrModules = [];
      let cryptoProperties = {};
      let aiProperties = {};
      const modulesMap = [];
      for (const module of modules) {
        if(module){
          let scan
          const {name, _id, projectId, version} = module;
          const details = {
            _id,
            name,
            version,
            projectId
          }
          let scanId = (moduleDataMap && moduleDataMap[module._id] && moduleDataMap[module._id].scanId)
          if(!scanId){
            let analysisId = module.statistics && module.statistics.analysisId;
            if (!analysisId) {
              let latestAnalysis = await ModuleAnalysis.findOneAsync(
                {moduleId: module._id},
                {sort: {date: -1}, fields: {scanId: 1}}
              );
              scanId = latestAnalysis && latestAnalysis.scanId;
              if (latestAnalysis) analysisId = latestAnalysis._id;
            } else {
              let analysis = await ModuleAnalysis.findOneAsync(analysisId, {fields: {scanId: 1}});
              scanId = analysis && analysis.scanId;
            }
            if (!module.statistics) module.statistics = {};
            if (analysisId) module.statistics.analysisId = analysisId;
          }
          if(scanId){
            scan = await Scans.findOneAsync(scanId);
            const {branch, tag, release, date} = scan || {};
            const analysisId = (moduleDataMap && moduleDataMap[module._id] && moduleDataMap[module._id].analysisId) ||
              (module.statistics && module.statistics.analysisId);
            details.analysis = {branch, tag, release, date, _id: analysisId}
          }
          if(module.customComponents && module.customComponents.length){
            if(scan){
              module.customComponents.forEach((c)=>{
                scan.dependencies.push(c)
              })
            }else{
              details.dependencies = module.customComponents
            }
          }
          let data = (scan || details)
          data.moduleId = _id
          cryptoProperties[_id] = _.sortBy(await Meteor.callAsync(CP_FIND, {projectId, moduleId: _id, companyId}), (item) => {
            return item.moduleId
          });
          aiProperties[_id] = _.sortBy(await Meteor.callAsync(AP_FIND, {projectId, moduleId: _id, companyId}), (item) => {
            return item.moduleId
          });
          scansOrModules.push(data)
          if(moduleId && moduleId === _id){
            moduleItem = details
          }
          modulesMap.push(details);
        }
      }
      cryptoProperties['project'] = await Meteor.callAsync(CP_FIND, {projectId, companyId});
      aiProperties['project'] = await Meteor.callAsync(AP_FIND, {projectId, companyId});
      let moduleComponents = [];
      let moduleDependencies = _.pick(project, 'name', 'description');
      moduleDependencies.dependencies = scansOrModules
      moduleDependencies = await ServerUtils.walkMap(moduleDependencies, moduleComponents);
      moduleComponents = Utils.cleanComponents(moduleComponents);
      return {
        list: moduleComponents,
        tree: moduleDependencies,
        stats: {
          components: moduleComponents.length,
          modules: modules.length
        },
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        },
        modules: modulesMap,
        module: moduleItem || null,
        cryptoProperties,
        aiProperties,
        company
      }
    }
  },
  getProjectCredits: async function (projectId, companyId, moduleId) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      if (moduleId) {
        query._id = moduleId;
      }
      const modules = await Modules.find(query).fetchAsync();
      let moduleItem;
      if (moduleId && modules.length > 0) {
        moduleItem = modules[0];
      }
      const project = projectId ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS}) : null;
      let moduleComponents = await getPartsListForModules(modules, project, null);
      const modulesMap = [];
      for (const module of modules) {
        if(module){
          module.analysis = await module.getAnalysisAsync();
          const {name, analysis, _id, projectId, version} = module;
          const {branch, tag, release, date} = analysis || {};
          const analysisId = analysis && analysis._id;
          modulesMap.push({
            _id,
            name,
            version,
            projectId,
            analysis: {branch, tag, release, date, _id: analysisId}
          });
        }
      }
      return {
        list: moduleComponents.components,
        stats: {
          components: moduleComponents.components && moduleComponents.components.length,
          modules: modules.length
        },
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        },
        modules: modulesMap,
        module: moduleItem || null
      }
    }
  },
  countCompanyProject: async function () {
    const user = await Meteor.userAsync();
    if(user && user.profile){
      const companyId = user.profile.companyId;
      return await Projects.find({companyId},{fields:{name:1}}).countAsync()
    }
  },
  getProjectCots: async function (projectId, companyId) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      let query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      const modules = await Modules.find(query).fetchAsync();
      query.$or = [
        {'properties.architecture':'cotsModule'},
        {commercialTerms: {$exists: true}}
      ];
      let cotsModules = await Modules.find(query).fetchAsync();
      for (const module of cotsModules) {
        if(module.cotsComponent && module.cotsComponent.key){
          module.meta = await COTSComponents.findOneAsync({key:module.cotsComponent.key});
        }
      }
      const project = projectId ? await Projects.findOneAsync({_id:projectId, companyId}) : null;
      let moduleCots = [];
      for (const module of modules) {
        const cots = module.getCotsComponents();
        if (cots && cots.length){
          for (const component of cots) {
            component.moduleId = module._id;
            component.moduleName = module.name;
            component.meta = await Components.findOneAsync({$or:[{key: component.key}, {oldKey: component.key}]});
            moduleCots.push(component);
          }
        }
      }
      let countComponents = moduleCots.length + cotsModules.length;
      let list = moduleCots.concat(cotsModules);
      list = _.map(list, function (component) {
        return {
          _id: component._id,
          key: component.key || component.name,
          version: component.version,
          commercialTerms: component.commercialTerms,
          architecture: component.properties ? component.properties.architecture : 'component',
          moduleId: component.moduleId ? component.moduleId : null,
          moduleName: component.moduleName ? component.moduleName : null,
          meta: component.meta && component.meta.data()
        }
      });
      return {
        list: list,
        stats: {
          components: countComponents
        },
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        }
      }
    }
  },
  bulkUpdateProjectLegalSettings: async function (projectId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Projects.updateAsync({
      $and: [
        {_id: {$ne: projectId}},
        { companyId },
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {requirements}}, {multi: true});
  },
  bulkUpdateMyProjectLegalSettings: async function (projectId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Projects.updateAsync({
      $and: [
        {_id: {$ne: projectId}},
        { companyId },
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {requirements}}, {multi: true});
  },
  getApprovedProjects: async function (params) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    let filter = params || {} ;
    filter.companyId = companyId;
    filter.approved = {$exists: true};
    const approves = await Approves.find(filter, {fields: {name: 1, modules: 1, projectId: 1, version: 1}}).fetchAsync();
    const grouped = Object.values(_.groupBy(approves, function (approve) {
      return approve.projectId
    }));
    const result = [];
    for (const approves of grouped) {
      if(approves && approves[0]){
        let projectDetails = await Projects.findOneAsync(approves[0].projectId, {fields: {name: 1, description: 1}});
        if(projectDetails){
          projectDetails.versions = approves;
        }else{
          projectDetails = {
            _id: 'REMOVED_PROJECT',
            name: 'REMOVED_PROJECT',
            description: 'This project has been removed and not available anymore',
            versions: approves
          }
        }
        result.push(projectDetails);
      }
    }
    return result;
  },
  getApprovedReleases: async function (params) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    let filter = params || {} ;
    filter.companyId = companyId;
    filter.approved = {$exists: true};
    const fields = {name: 1, modules: 1, projectId: 1, version: 1, approved:1, closedByName: 1}
    const approves = await Approves.find(filter, { fields }).fetchAsync();
    const results = [];
    for (const approve of approves) {
      let approveClass = new Approve(approve.companyId, approve.projectId, approve);
      results.push(await approveClass.getPublicDataAsync());
    }
    return results;
  },
  getReleasesCountByProject: async function (params) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    let filter = params || {} ;
    filter.companyId = companyId;
    filter.approved = {$exists: true};
    const fields = {name: 1}
    return {count: await Approves.find(filter, { fields }).countAsync()}
  },
  createLinkedModule: async function (moduleData) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    const project = await Projects.findOneAsync({_id: moduleData.projectId, companyId});
    moduleData.companyId = companyId;
    const existingModule = await Modules.findOneAsync({
      companyId,
      moduleIdentifier: moduleData.moduleIdentifier,
      projectId: moduleData.projectId
    }, {fields: {_id: 1}});
    let moduleId;
    if (existingModule) {
      moduleId = existingModule._id;
      await Modules.updateAsync(moduleId, {$set: {
        linkedProject: moduleData.linkedProject,
        version: moduleData.version,
        properties: moduleData.properties
      }});
    } else {
      moduleId = await Modules.insertAsync(moduleData);
    }

    // Get SBOM file from the release to build scan dependencies. The linked
    // release is always one of the caller's own approved projects (the UI
    // sources it from `approvedProjects`), so scope both reads by companyId -
    // a forged foreign approveId must not pull another tenant's SBOM tree.
    const linkApproveId = moduleData.linkedProject && moduleData.linkedProject.approveId;
    const approve = typeof linkApproveId === 'string'
      ? await Approves.findOneAsync({_id: linkApproveId, companyId}, {fields: {sbomFileId: 1}})
      : null;
    const sbomFile = approve && approve.sbomFileId
      ? await SbomFiles.findOneAsync({_id: approve.sbomFileId, companyId}, {fields: {tree: 1}})
      : null;

    let sbomDependencies = [];
    if (sbomFile && sbomFile.tree && sbomFile.tree.dependencies) {
      sbomDependencies = sbomFile.tree.dependencies.map(function sbomNodeToScanDep(node) {
        return {
          name: node.name,
          key: node.key,
          description: node.description || node.name,
          versions: [typeof node.version === 'string' ? node.version : '0.0.0'],
          licenses: node.license ? [{name: node.license, url: node.licenseUrl, key: node.licenseKey}] : null,
          homepageUrl: node.homepageUrl || null,
          repoUrl: node.repoUrl || null,
          dependencies: (node.dependencies || []).filter(function (child) { return child.key; }).map(sbomNodeToScanDep)
        };
      }).filter(function (dep) { return dep.key; });
    }

    const scan = {
      projectId: !moduleData.projectId && project ? project._id : moduleData.projectId || undefined,
      project: project && project.name || undefined,
      companyId,
      submitted: new Date(),
      module: moduleData.name,
      moduleId,
      moduleIdentifier: moduleData.moduleIdentifier,
      user: Utils.userEmail(user)
    };
    scan.dependencies = [{
      name: moduleData.name,
      description: moduleData.name,
      homepageUrl: null,
      repoUrl: null,
      key: moduleData.moduleIdentifier,
      versions: [moduleData.version || '1.0-SNAPSHOT'],
      licenses: null,
      dependencies: sbomDependencies
    }];
    const scanId = await Scans.insertAsync(scan);
    if(scanId){
      Meteor.defer(async function () {
        try {
          await processScan(scanId, user, companyId);
        } catch (err) {
          console.log('processScan error: ',err)
        }
      });
    }
    if(moduleData && moduleData.linkedProject && moduleData.linkedProject.projectId){
      const followProject= await Projects.findOneAsync({_id: moduleData.linkedProject.projectId, companyId});
      if(followProject){
        if (!followProject.relatedUsers){
          followProject.relatedUsers = {}
        }
        if (!followProject.relatedUsers.followers){
          followProject.relatedUsers.followers = []
        }
        followProject.relatedUsers.followers.push(user._id);
        try {
          await Projects.updateAsync(followProject._id, {$set: {'relatedUsers.followers':followProject.relatedUsers.followers}});
          const type = 'project';
          await postActions(null, followProject, type, 'follow');
        } catch(error) {
          const type = 'project';
          await postActions(error, followProject, type, 'follow');
        }
      }
    }
  },
  getProjectDependent: async function (projectId, companyId) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      let project = null;
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        project = await Projects.findOneAsync({_id: projectId, companyId}, {fields: PROJECT_SECRET_FIELDS});
        query['linkedProject.projectId'] = projectId;
      }
      const modules = await Modules.find(query, {fields:{name:1, linkedProject:1, projectId: 1}}).fetchAsync();
      const projectIds = _.unique(_.map(modules, function (module) {
        return module.projectId
      }));
      const projectsQuery = {companyId, _id: {$in:projectIds}};
      let projects = await Projects.find(projectsQuery, {fields:{name:1, relatedUsers:1, description:1}}).fetchAsync();
      let resolvedProjects = [];
      for (const project of projects) {
        const {_id, name, description, relatedUsers} = project;
        let projectObj = {_id, name, description, relatedUsers: {}};
        if(relatedUsers){
          projectObj.relatedUsers.defaultProjectManager =
            await Meteor.users.findOneAsync(relatedUsers.defaultProjectManager, {fields:{profile:1}});
          projectObj.relatedUsers.defaultComplianceManager =
            await Meteor.users.findOneAsync(relatedUsers.defaultComplianceManager, {fields:{profile:1}});
        }
        resolvedProjects.push(projectObj);
      }
      projects = resolvedProjects;
      return {
        list : projects,
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        }
      };
    }
  },
  getProjectCriticalComponents: async function (projectId, companyId) {
    companyId = await projectScopedCompanyId(companyId);
    if (projectId) {
      let company
      if(companyId){
        company = await Companies.findOneAsync(companyId,{fields:{name:1,distribution:1,writtenOffer:1}})
      }
      let moduleDataMap = {}
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      const modules = await Modules.find(query,{fields:{name:1,moduleIdentifier:1,projectId:1,companyId:1,
        properties:1,version:1,statistics:1,customComponents:1}}).fetchAsync();
      const project = projectId
        ? await Projects.findOneAsync({_id: projectId, companyId}, {fields: {name: 1,version: 1,companyId: 1}})
        : null;
      let scansOrModules = [];
      const modulesMap = [];
      for (const module of modules) {
        if(module){
          let scan
          const {name, _id, projectId, version} = module;
          const details = {
            _id,
            name,
            version,
            projectId
          }
          let scanId = (moduleDataMap && moduleDataMap[module._id] && moduleDataMap[module._id].scanId)
          if(!scanId){
            let analysis = await ModuleAnalysis.findOneAsync(module.statistics && module.statistics.analysisId,
              {fields: {scanId: 1}})
            scanId = analysis && analysis.scanId
          }
          if(scanId){
            scan = await Scans.findOneAsync(scanId);
            const {branch, tag, release, date} = scan || {};
            const analysisId = (moduleDataMap && moduleDataMap[module._id] && moduleDataMap[module._id].analysisId) ||
              (module.statistics && module.statistics.analysisId);
            details.analysis = {branch, tag, release, date, _id: analysisId}
          }
          if(module.customComponents && module.customComponents.length){
            if(scan){
              module.customComponents.forEach((c)=>{
                scan.dependencies.push(c)
              })
            }else{
              details.dependencies = module.customComponents
            }
          }
          scansOrModules.push((scan || details))
          modulesMap.push(details);
        }
      }
      let moduleComponents = [];
      let moduleDependencies = _.pick(project, 'name', 'description');
      moduleDependencies.dependencies = scansOrModules
      moduleDependencies = await ServerUtils.walkMap(moduleDependencies, moduleComponents, true);
      moduleComponents = Utils.cleanComponents(moduleComponents);
      return {
        list: moduleComponents,
        tree: moduleDependencies,
        stats: {
          components: moduleComponents.length,
          modules: modules.length
        },
        project : project || {
          name:UNASSIGNED,
          _id: Projects.UNASSIGNED
        },
        modules: modulesMap,
        company
      }
    }
  },
  forceDeleteProject: async function ({_id, name}) {
    let user = await Meteor.userAsync();
    if (_id) {
      const companyId = user.profile.companyId;
      if (await Roles.userIsInRole(user, ['manager'], companyId)) {
        // Tenant isolation: only delete a project owned by the caller's company.
        const ownProject = await Projects.findOneAsync({_id, companyId}, {fields: {_id: 1}});
        if (!ownProject) {
          throw new Meteor.Error(403, 'Access Denied');
        }
        try {
          await Modules.removeAsync({projectId: _id, companyId});
          const message = `All modules of project ${name} deleted`
          await Meteor.callAsync('logEvent', user, message, 'moduleDeleted');
          try {
            const data = await Projects.removeAsync({_id, companyId});
            if (data !== 1) {
              const message = IE + ('Project: ' + name + ' not deleted');
              await Meteor.callAsync('logEvent', user, message, 'projectDeleted');
            } else {
              await Meteor.callAsync('logEvent', user, name, 'projectDeleted');
            }
            return data
          } catch(error) {
            const message = IE + ((error && error.reason) || 'Project: ' + name + ' not deleted');
            await Meteor.callAsync('logEvent', user, message, 'projectDeleted');
          }
        } catch(error) {
          const message = IE + (error.reason || 'Modules of project ' + name + ' are not deleted');
          await Meteor.callAsync('logEvent', user, message, 'moduleDeleted');
        }
      }else{
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
  },
  'CryptoAlgorithms.Find': async function ({projectId, moduleId, apiUser}){
    const user = (await Meteor.userAsync()) || apiUser;
    const companyId = user && user.profile && user.profile.companyId;
    const moduleIds = []
    if(moduleId){
      moduleIds.push(moduleId);
    }
    if(projectId && companyId){
      return await Meteor.callAsync('getProjectAlgorithms', projectId, companyId, moduleIds);
    }
  },
  'AiModels.Find': async function ({projectId, moduleId, apiUser}){
    const user = (await Meteor.userAsync()) || apiUser;
    const companyId = user && user.profile && user.profile.companyId;
    const moduleIds = []
    if(moduleId){
      moduleIds.push(moduleId);
    }
    if(projectId && companyId){
      return await Meteor.callAsync('getProjectAiModels', projectId, companyId, moduleIds);
    }
  }
});

async function postActions(error, item, type, action) {
  const user = await Meteor.userAsync();
  if (error) {
    await Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'followAction');
  } else {
    await Meteor.callAsync('logEvent', user, 'User '+user.profile.name+' ('+user.profile.email+') choose to '+action+' ' +type+' '+item.name,
      'followAction');
  }
}

function getModuleAnalysis(approve, moduleId) {
  if(approve){
    let module = _.find(approve.modules,function (module) {
      return module._id === moduleId
    });
    if(module){
      return module.analysisId;
    }
  }
  return false
}

async function getPartsListForModules(modules, project, release, approve) {
  let list = [];
  for (const module of modules) {
    const components = [];
    const moduleComponents = await module.getAllComponentsAsync(release, getModuleAnalysis(approve, module._id));
    if (moduleComponents && moduleComponents instanceof Array) {
      for (const comp of moduleComponents) {
        let component;
        if(comp.key.indexOf('im:') === 0){
          component = await InfrastructureComponents.findOneAsync({key: comp.key});
        }else{
          component = await Components.findOneAsync({$or:[{key: comp.key}, {oldKey: comp.key}]});
        }
        if (component) {
          components.push(mapComponent(comp, component));
        }
      }
    }
    list.push(components)
  }
  let result;
  if(project.name){
    result = _.pick(project, 'name', 'description');
  }else{
    result = _.pick(modules[0], 'name', 'description');
  }
  result.components = _.sortBy(_.unique(_.flatten(list),'name'), function (i) {
    if(i && i.name){
      return i.name.toLowerCase()
    }else if (i && i.key){
      return i.key.toLowerCase()
    }
  });
  return result
}

function mapComponent(proComp, component) {
  if (proComp.info) {
    component.data().info = proComp.info;
  }
  const result = {
    name: component.getName(),
    key: component.getKey(),
    _id: component.data()._id
  };
  if (component.getUrl('homepage')) {
    result.homepageUrl = component.getUrl('homepage');
  }

  proComp.versions.forEach(function (v) {
    const version = component.findVersion(v.version);
    if (version) {
      version.getLicenses(component.getDeclaredLicenses()).forEach(function (lic) {
        result.version = v.version;
        result.license = lic.getName();
        result.licenseUrl = lic.getUrl();
        result.licenseKey = lic.getKey();
      });
      result.copyright = version.getCopyright();
    }
  });

  return result;
}

function groupByKey(list) {
  const groupedMap = new Map();
  for (const item of list) {
    if (!groupedMap.has(item.key)) {
      groupedMap.set(item.key, {
        ...item,
        problems: [...item.problems],
        paths: [...item.paths]
      });
    } else {
      const existing = groupedMap.get(item.key);
      const versionSet = new Set(
        (existing.versions + ',' + item.versions)
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
      );
      existing.versions = [...versionSet].join(', ');
      existing.paths.push(...item.paths);
      existing.countPath = existing.paths.length;
    }
  }
  return Array.from(groupedMap.values())
}

function confidenceMap(score) {
  if (score) {
    if (score === 5) {
      return 1
    } else if (score === 4) {
      return 2
    } else if (score === 2) {
      return 4
    } else if (score === 1) {
      return 5
    } else {
      return score
    }
  }
  return 5;
}

/**
 * Create global raw Collection and ensure indexes
 */

export let RawProjects;

Meteor.startup(function () {
  RawProjects = Utils.makeRawCollection(Projects);
  RawProjects.createIndex('companyId');
  // Backs every name->project lookup, which otherwise scans the whole
  // companyId bucket. NON-unique deliberately: duplicates already exist in the wild, and
  // this runs un-awaited inside a startup hook, so a unique build failing on them would
  // surface as an unhandled rejection - which Node terminates the process for.
  RawProjects.createIndex({companyId: 1, name: 1});
});

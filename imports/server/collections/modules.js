import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {Mongo} from 'meteor/mongo';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import RequirementsHistory from '/imports/lib/collections/requirementsHistory';
import Companies from '/imports/lib/collections/companies';
import Component from '/imports/lib/component/Component';
import Scans from '/imports/lib/collections/scans';
import Constraints from '/imports/lib/collections/constraints';
import Rules from '/imports/lib/collections/rules';
import Pluralize from 'pluralize';
import Utils from '/imports/server/ServerUtils';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {mailFooter} from '/imports/server/mail/footer';
import {Config} from '/imports/server/config';
import Vulnerability from '/imports/lib/component/Vulnerability';
import {applyResolvedLicenses, applyRootLicense} from '/imports/server/scan/processScan';
import {runTsCheck} from '/imports/startup/server/ts-check';
import {releaseAnalysisStatus, sendAnalysisWebhook, tsAnalyze} from '/imports/startup/server/ts-analysis';
import {containsTextRegex} from '/imports/lib/security/searchRegex';
import {resolveActingUser} from '/imports/server/security/actingUser';
import {requireModuleAccess, requireProjectAccess} from '/imports/server/security/methodGuards';
import {companyListRoles} from '/imports/lib/company/settingsAccess';

const AD = 'Access Denied'
const DROPPED = ' were dropped'
const WERE_IDENTIFIED = ' were identified'
const PUT_TO_BL_FOR = ' put to deny for '
const REMOVE_FROM_BL_FOR = ' removed from denied for '
const MESSAGE_CREATE = 'Messages.Create'

// Canonical form of a vulnerability identifier. CVE ids are upper case throughout; GHSA ids
// are `GHSA-` followed by a lower-case suffix, and the vulnerability service matches those
// case-sensitively, so upper-casing one silently yields an advisory with no content.
function normalizeVulnerabilityId(id) {
  if (typeof id !== 'string') {
    return id;
  }
  const trimmed = id.trim();
  return /^GHSA-/i.test(trimmed)
    ? 'GHSA-' + trimmed.slice('GHSA-'.length).toLowerCase()
    : trimmed.toUpperCase();
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

Meteor.publish('modulesByProject', async function (projectId, limited) {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId && userId){
    const user = await Meteor.userAsync();
    let query = {
      companyId: companyId
    }
    if (projectId === Projects.UNASSIGNED) {
      query.projectId = {$exists: false};
    } else if (projectId) {
      query.projectId = projectId;
    }
    let fields = limited ? {companyId:1, projectId:1, name:1, relatedUsers:1, statistics:1, quality: 1, requirements:1,
      tags:1, properties: 1, moduleIdentifier:1, confidenceMinScore: 1, urls: 1, infrastructureComponent: 1, cotsComponent: 1,
      analyzed: 1, scanned: 1, legalRulesConfig: 1, obligationConfig: 1, demo: 1} : undefined
    if(await Roles.userIsInRole(user, ['portfolio_manager'], companyId)){
      return Modules.find(query, {fields});
    }else{
      return Modules.find({
        $and: [query, {
          $or: [
            {'relatedUsers': { $exists: false }},
            {'relatedUsers.members': { $exists: false }},
            {'relatedUsers.members': []},
            {'relatedUsers.members': userId},
            {'relatedUsers.defaultProjectManager': userId},
            {'relatedUsers.defaultComplianceManager': userId}
          ]
        }]
      }, {fields});
    }
  }
  this.ready();
});

Meteor.publish('modules', async function () {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId && userId){
    const user = await Meteor.userAsync();
    if(await Roles.userIsInRole(user, ['portfolio_manager'], companyId)){
      return Modules.find({
        companyId: companyId
      });
    }else{
      return Modules.find({
        $and: [{
          companyId: companyId
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
      });
    }
  }
  this.ready();
});

Meteor.publish('moduleById', async function (moduleId) {
  const userId = this.userId;
  const companyId = await Utils.getCompanyIdForUserAsync(userId);
  if(companyId && userId){
    const user = await Meteor.userAsync();
    let fields = {analysis:0}
    if(await Roles.userIsInRole(user, ['portfolio_manager'], companyId)){
      return Modules.find({
        _id: moduleId,
        companyId: companyId
      }, {fields});
    }else{
      return Modules.find({
        $and: [{
          _id: moduleId,
          companyId: companyId
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
      }, {fields});
    }
  }
  this.ready();
});

Meteor.publish('infrastructureModules', async function () {
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  if (!companyId) {
    return this.ready();
  }
  return Modules.find({companyId, 'properties.architecture': 'infrastructureModule'},
    {sort: {name: -1}})
});

Meteor.publish('cotsModules', async function () {
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  if (!companyId) {
    return this.ready();
  }
  return Modules.find({companyId, 'properties.architecture': 'cotsModule'},
    {sort: {name: -1}})
});

Meteor.publish('infrastructureModule', async function (id) {
  const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
  if (!companyId) {
    return this.ready();
  }
  return Modules.find({_id: id, companyId})
});

Modules.allow({
  insert: async function (userId, doc) {
    return (await checkRoleAndCompany(doc)) && projectInCompany(doc.projectId, doc.companyId);
  },
  remove: async function (userId, module) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if (!user || !(await Roles.userIsInRole(user, ['developer', 'manager', 'company_component_manager'], companyId))) {
      throw new Meteor.Error(403, AD);
    }
    if (!user.profile || companyId !== module.companyId) {
      throw new Meteor.Error(403, AD);
    }
    return true;
  },
  update: async function (userId, module, fieldNames, modifier) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if (checkIfFollowing(userId, user, module, fieldNames, modifier)) {
      return true
    }
    if (!user || !(await Roles.userIsInRole(user, ['developer', 'manager', 'compliance_manager', 'company_component_manager'], companyId))) {
      throw new Meteor.Error(403, AD);
    }
    if (!user.profile || companyId !== module.companyId) {
      throw new Meteor.Error(403, AD);
    }
    // A module never changes company, and moves only to a project of its own company.
    if (fieldNames.indexOf('companyId') > -1 || fieldNames.indexOf('_id') > -1) {
      return false;
    }
    if (fieldNames.indexOf('projectId') > -1) {
      const newProjectId = modifier && modifier.$set && modifier.$set.projectId;
      return projectInCompany(newProjectId, companyId);
    }
    return true;
  },
  fetch: ['companyId', 'relatedUsers']
});

Modules.after.update(async function (userId, doc, fieldNames, modifier) {
  if(fieldNames.indexOf('requirements') > -1 && fieldNames.indexOf('analysisRequired') > -1 &&
    modifier && modifier['$set'] && modifier['$set'].requirements){
    try {
      const commonSettings = { companyId: doc.companyId, moduleId: doc._id }
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
          moduleId: commonSettings.moduleId,
          companyId: commonSettings.companyId,
          userId: userId,
          userName: Utils.username(user),
          requirements: requirements
        }
        await RequirementsHistory.insertAsync(model)
      }
    }catch (e) {
      console.log('Modules.after.update: ',e)
    }
  }
}, {fetchPrevious: false});

Modules.after.remove(async function (userId, doc) {
  const commonSettings = { companyId: doc.companyId, moduleId: doc._id }
  await ModuleAnalysis.removeAsync(commonSettings)
  await RequirementsHistory.removeAsync(commonSettings)
}, {fetchPrevious: false});

// Follow/unfollow (common/follow.js) by any member of the module's company.
function checkIfFollowing(userId, user, module, fieldNames, modifier) {
  if (Object.keys(modifier).length === 1 && Object.keys(modifier)[0] === '$set' &&
    Object.keys(modifier.$set).length === 1 && Object.keys(modifier.$set)[0] === 'relatedUsers.followers') {
    return !!user && userId === user._id && fieldNames.length === 1 && fieldNames.indexOf('relatedUsers') > -1
      && !!module && !!user.profile && module.companyId === user.profile.companyId;
  }
}

async function projectInCompany(projectId, companyId) {
  if (typeof projectId !== 'string' || !companyId) {
    return false;
  }
  return !!(await Projects.findOneAsync({_id: projectId, companyId}, {fields: {_id: 1}}));
}

async function checkRoleAndCompany(doc) {
  const user = await Meteor.userAsync();
  const companyId = user.profile.companyId;
  if (user && (await Roles.userIsInRole(user, ['manager', 'compliance_manager'], companyId))) {
    // Be sure that infrastructureModule is true. To know that this is custom module
    return companyId === doc.companyId;
  }
  return false;
}

function getWarnings(analysis) {
  return analysis.statistics.legal.warnings + analysis.statistics.vulnerability.warnings +
    (analysis.statistics.viability ? analysis.statistics.viability.warnings : 0) + analysis.statistics.integrity.warnings +
    (analysis.statistics.versioning ? analysis.statistics.versioning.warnings : 0)
}

function getViolations(analysis) {
  return analysis.statistics.legal.violations + analysis.statistics.vulnerability.violations +
    (analysis.statistics.viability ? analysis.statistics.viability.violations : 0) + analysis.statistics.integrity.violations +
    (analysis.statistics.versioning ? analysis.statistics.versioning.violations : 0)
}

function getVulnerabilities(analysis) {
  return analysis.statistics.vulnerability.warnings +
    analysis.statistics.vulnerability.violations
}

function getUserName(user) {
  if (user) {
    if (user.profile && user.profile.name) {
      return user.profile.name;
    }
    if (user.name) {
      return user.name;
    }
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if (user.profile.email){
      return user.profile.email
    }
  }
  return false
}

function getUniqueLink(elem){
  return [(elem.ruleKey||''),(elem.obligationKey||''),(elem.cveKey||''),(elem.ecs||''),(elem.jira||''),
    (elem.tfs||''), (elem.key||''), (elem.version||''), (elem.path||'')].join()
}

function isCveWhiteListed (cveKey, componentKey, versionName, module) {
  return (module && typeof module.isCveWhitelisted === 'function' && module.isCveWhitelisted(cveKey, componentKey, versionName))
}

// The shared handler behind Modules.PropagateLicensePicks and its legacy alias
// Modules.PropagateRootLicense. A plain function rather than an arrow, because
// it calls this.unblock().
async function propagateLicensePicks(moduleId) {
  // The id goes straight into two selectors. `{$ne: null}` would pick an
  // ARBITRARY module of the caller's own company and, worse, the latest scan of
  // an arbitrary module of that company - so module A's picks would be written
  // into module B's scan and persisted. Company-scoped, but within-tenant
  // integrity corruption is still corruption. Same guard reprocessScan carries.
  if (typeof moduleId !== 'string' || !moduleId) {
    throw new Meteor.Error(400, 'Invalid module id');
  }
  const user = await Meteor.userAsync();
  if (!user || !user.profile || !user.profile.companyId) {
    throw new Meteor.Error(403, AD);
  }
  const companyId = user.profile.companyId;
  // The same two roles Modules.ResolveComponentLicense requires. Now
  // this method no longer just re-analyses: it rewrites the license lists of
  // arbitrarily many dependency nodes of a stored scan and persists them.
  if (!await Roles.userIsInRole(user, ['compliance_manager', 'manager'], companyId)) {
    throw new Meteor.Error(403, AD);
  }
  const module = await Modules.findOneAsync({_id: moduleId, companyId});
  if (!module) throw new Meteor.Error(404, 'Module not found');
  const company = await Companies.findOneAsync(companyId);
  // module._id, not the argument: the module has been resolved and checked by
  // here, and the scan must belong to THAT module and no other.
  const scan = await Scans.findOneAsync({companyId, moduleId: module._id},
    {sort: {submitted: -1}});
  if (scan) {
    try {
      // Same order as processScan: the manually resolved per-component licenses
      // first, then the root, which owns the root node from the same slot.
      await applyResolvedLicenses(scan, module, company, user);
      await applyRootLicense(scan, module, company, user);
      // Same targeted write as processScan: both functions only
      // touch dependency license lists, and replacing the whole document here
      // discarded any concurrent write to the rest of the scan.
      //
      // Guarded and company-scoped so the two siblings read identically. cleanDoc() drops
      // empty arrays, so a scan submitted with `dependencies: []` is stored with no such
      // field at all - an unguarded $set then wrote `dependencies: null` onto it, which is
      // neither what was submitted nor something the readers of a scan expect.
      if (Array.isArray(scan.dependencies)) {
        await Scans.updateAsync({_id: scan._id, companyId},
          {$set: {dependencies: scan.dependencies}});
      }
    } catch (error) {
      console.error('=> Modules.PropagateLicensePicks: applying the license picks failed for module',
        moduleId, '-', error.reason || error.message || error);
    }
  }
  this.unblock();
  // The scan update above is NOT only for the scan/SBOM views: for a per-component
  // pick it is the only channel the analyzer has. ts-analysis reads
  // componentConfig.licensesSelected (Module.resolveAssignedLicense) solely for a
  // dependency that declares no license at all, and the injection above makes that
  // false, so the marked entry in the scan is what it acts on. Honouring that marker
  // on an ordinary dependency needs ts-analysis 3.7.8 or later; before it the pick
  // was applied to the root component only.
  try {
    await Meteor.callAsync('analyzeModule', moduleId, module.demo, user, scan && scan._id);
  } catch (error) {
    console.error('=> Modules.PropagateLicensePicks: analyzeModule failed for module', moduleId, '-',
      error.reason || error.message || error);
  }
  return {scanId: scan && scan._id};
}

// The license and vulnerability check for a list of components, against one project
// and module of ONE company. Both ids arrive from the caller, so they are read
// company-scoped: reading them bare would run the check against another tenant's project
// and module, with that tenant's confidence, obligation and legal-rule configuration.
// The Meteor method passes the signed-in user's company; the REST check passes the
// company of the API key, which has no signed-in user to read it from.
export async function checkComponentForCompany(companyId, projectId, moduleId, components) {
  const project = await Projects.findOneAsync({_id: projectId, companyId});
  const module = await Modules.findOneAsync({_id: moduleId, companyId});
  // One message for both misses: which of the two ids was the foreign one is
  // not something the caller needs to learn.
  if (!project || !module) {
    throw new Meteor.Error(404, 'Module not found');
  }
  const minConfidence = module.confidenceMinScore || project.confidenceMinScore;
  let moduleComponents = [];
  _.each(components,function (component) {
    moduleComponents.push({
      key: component.key,
      name: component.name,
      versions: [{
        version: component.versions && component.versions[0],
        licenses: [{
          key: component.licenses && component.licenses[0] && component.licenses[0].key || 'NO-LICENSE'
        }],
        paths: [{
          path:'/',
          params: ['isUnchanged']
        },{
          path:'/',
          params: ['isChanged']
        }]
      }]
    });
  });
  let results = [];
  try{
    let request = await runTsCheck(Utils.rebuildModuleObject(module, moduleComponents, project));
    if (request.data) {
      const notViolatedRules = await Rules.find({type: 'warning'}).fetchAsync();
      const notViolatedRulesKeys = _.map(notViolatedRules, c => c.key)
      let obligationConfig;
      if(project && project.obligationConfig){
        obligationConfig = _.extend(project.obligationConfig, module.obligationConfig);
      }else{
        obligationConfig = module.obligationConfig
      }
      let legalRulesConfig;
      if(project && project.legalRulesConfig){
        legalRulesConfig = _.extend(project.legalRulesConfig, module.legalRulesConfig);
      }else{
        legalRulesConfig = module.legalRulesConfig
      }
      // ONE batched lookup for the whole request, then the pure build() per
      // component - not one query per element. for...of, not _.each: an
      // `await` inside an _.each callback simply does not run before the
      // iteration returns.
      const cveIndex = await Vulnerability.loadCveIndexAsync(
        moduleComponents.map(function (item) { return item.key; }));
      for (const componentItem of moduleComponents) {
        let versions  = [];
        let oneVersion = componentItem.versions[0].version;
        versions.push(oneVersion);
        let vulnerabilities = [];
        const vulns = Vulnerability.build(cveIndex.get(componentItem.key) || [], [],
          componentItem.key, versions);
        vulns.forEach(vuln => {
          const whitelisted = isCveWhiteListed(vuln.getName(), componentItem.key, null, module)
          if(!minConfidence || !vuln.ecs.confidence ||
            (vuln.ecs.confidence && minConfidence && confidenceMap(+minConfidence) >= vuln.ecs.confidence)) {
            vulnerabilities.push(
              {
                name: vuln.getName(),
                status: whitelisted ? 'whitelisted' : vuln.getScoreLabel(),
                cvssColor: vuln.getCVSSColor(),
                score: !isNaN(vuln.getScore()) ? vuln.getScore().toFixed(1) : vuln.getScore(),
                link: vuln.getLink()
              }
            );
          }
        });
        results.push({
          component: {
            key: componentItem.key,
            name: componentItem.name,
            version: oneVersion
          },
          not_changed: Utils.normalizeLicenseStatus(request.data[module.name][componentItem.key+':'
          +(oneVersion)+':0'][componentItem.versions[0].licenses[0].key],
          componentItem.key, obligationConfig, legalRulesConfig, notViolatedRulesKeys),
          changed: Utils.normalizeLicenseStatus(request.data[module.name][componentItem.key+':'
          +(oneVersion)+':1'][componentItem.versions[0].licenses[0].key],
          componentItem.key, obligationConfig, legalRulesConfig, notViolatedRulesKeys),
          license: componentItem.versions[0].licenses[0].key,
          vulnerabilities: vulnerabilities
        });
      }
    }
  }catch (error) {
    console.info('=> checkComponent: ', error);
    if(error.code === 'ECONNREFUSED' || error.Error && error.Error.indexOf('ETIMEDOUT') > -1){
      throw new Meteor.Error(error, 'Service is not available');
    }else{
      throw new Meteor.Error(error,  (typeof error.reason === 'string' || error.reason instanceof String)
        ? error.reason : 'Service has internal problem');
    }
  }
  return results
}

Meteor.methods({
  moduleFindOne: async function (moduleId){
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    return await Modules.findOneAsync({_id:moduleId, companyId});
  },
  modulesByProject: async function (projectId, limited){
    const user = await Meteor.userAsync();
    const userId = user && user._id;
    const companyId = user && user.profile && user.profile.companyId;
    if(companyId && userId){
      let query = {
        companyId: companyId
      }
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else if (projectId) {
        query.projectId = projectId;
      }
      let fields = limited ? {companyId:1, projectId:1, archived:1, name:1, relatedUsers:1, statistics:1, quality: 1, requirements:1,
        tags:1, properties: 1, moduleIdentifier:1, confidenceMinScore: 1, urls: 1, infrastructureComponent: 1, cotsComponent: 1, demo: 1,
        // The grid cards show the last analysis and scan dates.
        analyzed: 1, scanned: 1} : undefined
      if(await Roles.userIsInRole(user, ['portfolio_manager'], companyId)){
        return await Modules.find(query, {fields}).fetchAsync();
      }else{
        return await Modules.find({
          $and: [query, {
            $or: [
              {'relatedUsers': { $exists: false }},
              {'relatedUsers.members': { $exists: false }},
              {'relatedUsers.members': []},
              {'relatedUsers.members': userId},
              {'relatedUsers.defaultProjectManager': userId},
              {'relatedUsers.defaultComplianceManager': userId}
            ]
          }]
        }, {fields}).fetchAsync();
      }
    }
  },
  // Re-applies every license this app injects - the per-component ones a
  // compliance manager set manually and then the root component's -
  // to the module's latest scan blob, and re-runs analysis so the dependency list
  // reflects them without requiring a full scan reprocess. Triggered by the
  // license pickers after they save componentConfig.licensesSelected.
  //
  // Registered under BOTH names below: `Modules.PropagateRootLicense` was the
  // original name and stays as an alias, because Meteor re-sends an
  // outstanding method call on reconnect - a call in flight across a
  // deploy would otherwise fail with "method not found".
  'Modules.PropagateLicensePicks': propagateLicensePicks,
  'Modules.PropagateRootLicense': propagateLicensePicks,

  analyzeModule: async function (moduleId, demo, userData, scanId) {
    // Both ids go straight into the analysis worker's database queries.
    if (typeof moduleId !== 'string' || (scanId !== undefined && scanId !== null && typeof scanId !== 'string')) {
      throw new Meteor.Error(400, 'Invalid module or scan id');
    }
    // A client call acts as the session user; server callers (processScan, the
    // license propagation) pass a trusted userData with no connection.
    const user = await resolveActingUser(this, userData);
    const startTime = new Date();
    const companyId = user.profile.companyId;
    let summary;
    try {
      const {_id, profile, emails} = user;
      const outcome = await tsAnalyze({
        companyId,
        moduleId,
        userId: user._id,
        user: {_id, profile, emails},
        scanId,
        demo
      });
      // The worker already wrote the analysis and the module statistics to this database.
      summary = outcome.summary || {};
      if (outcome.summary) {
        await sendAnalysisWebhook(companyId, outcome);
      }
      await Meteor.callAsync('notifyAboutAnalysis', moduleId, companyId);
    } catch (error) {
      console.log('=> TSAnalysisError: ', error.message || error.reason)
      await releaseAnalysisStatus(moduleId, companyId);
      if (error.errorType === 'Meteor.Error') throw error;
      throw new Meteor.Error(error.message || 'analysis-error', error.reason || error.message);
    } finally {
      console.info('=> TSAnalysis: took %s millis', new Date() - startTime);
    }
    return summary;
  },
  analyzeAllModules: async function (projectId) {
    if (this.userId && projectId) {
      this.unblock();
      const user = await Meteor.userAsync();
      const companyId = user.profile.companyId;
      const query = {companyId};
      if (projectId === Projects.UNASSIGNED) {
        query.projectId = {$exists: false};
      } else {
        query.projectId = projectId;
      }
      let status = [];
      const modules = await Modules.find(query).fetchAsync();
      for (const module of modules) {
        if((module.infrastructureComponent && module.infrastructureComponent.key) ||
          (module.cotsComponent && module.cotsComponent.key)){
          status.push(await Meteor.callAsync('Modules.AnalyzeWithoutScan', module._id));
        }else{
          status.push(await Meteor.callAsync('analyzeModule', module._id, module.demo, user));
        }
      }
      status = _.filter(status,function (elem) {
        return !!elem
      });
      return status.length
    }
  },
  analyzeAllCompanyModules: async function () {
    if (this.userId) {
      this.unblock();
      const user = await Meteor.userAsync();
      const companyId = user.profile.companyId;
      const query = {companyId};
      let status = [];
      const modules = await Modules.find(query).fetchAsync();
      for (const module of modules) {
        if((module.infrastructureComponent && module.infrastructureComponent.key) ||
          (module.cotsComponent && module.cotsComponent.key)){
          status.push(await Meteor.callAsync('Modules.AnalyzeWithoutScan', module._id));
        }else{
          status.push(await Meteor.callAsync('analyzeModule', module._id, module.demo, user));
        }
      }
      status = _.filter(status,function (elem) {
        return !!elem
      });
      return status.length
    }
  },
  deleteModuleAnalysis: async function (moduleId) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if (!user || !await Roles.userIsInRole(user, 'manager', companyId)) {
      throw new Meteor.Error(403, AD);
    }
    if (!user.profile || !companyId) {
      throw new Meteor.Error(403, AD);
    }
    return await ModuleAnalysis.removeAsync({moduleId, companyId});
  },
  getModuleComponents: async function (moduleId, analysisId, listComponents, moduleObject) {
    const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
    const module = moduleObject || (companyId && await Modules.findOneAsync({_id: moduleId, companyId}));
    if (module) {
      let components = listComponents || (await module.getAllComponentsAsync(null, analysisId)) || [];
      components = components.map((projComp) => {
        let component = new Component(projComp)
        if (component) {
          const data = component.data();
          data.problems = projComp.problems;
          data.info = projComp.info;
          if(projComp.root){
            data.root = true
          }
          projComp.versions.forEach(function (v) {
            const version = component.findVersion(v.version);
            if (version) {
              version.data().paths = v.paths;
            }
          });
          data.status = projComp.status
          data.statuses = projComp.statuses
          data.label = projComp.label
          return data;
        }
      });
      components = _.compact(components);
      return components;
    } else {
      return;
    }
  },
  getModuleAnalysis: async function (moduleId, release, tag, branch) {
    await requireModuleAccess(this, moduleId);
    let module = await Modules.findOneAsync(moduleId,{fields:{companyId: 1}});
    if(module){
      let filter = {
        companyId: module.companyId,
        moduleId
      };
      if(release){
        filter.release = release
      }
      if(branch){
        filter.branch = branch
      }
      if(tag){
        filter.tag = tag
      }
      return await ModuleAnalysis.find(filter, {sort: {date: -1}, limit: 100,
        fields:{date: 1, scanId: 1, release: 1, tag: 1, branch: 1, binaryLinks: 1}}).fetchAsync()
    }
  },
  updateLastAnalysis: async function (moduleId, release, analysisId) {
    await requireModuleAccess(this, moduleId);
    let module = await Modules.findOneAsync(moduleId,{fields:{companyId: 1}});
    let filter = {
      moduleId,
      companyId: module.companyId
    };
    if(analysisId){
      filter._id = analysisId
    }else{
      const analysis = await ModuleAnalysis.findOneAsync(filter, {sort: {date: -1}, fields:{date: 1}})
      filter._id = analysis._id
    }
    return await ModuleAnalysis.updateAsync(filter, {$set: {release: release && release.name}});
  },
  setModuleRelatedUsers: async function (userId, doc) {
    const user = await Meteor.users.findOneAsync(userId);
    const companyId = user.profile.companyId;
    const project = await Projects.findOneAsync({_id: doc.projectId, companyId});
    if (project && project.relatedUsers) {
      doc.relatedUsers = project.relatedUsers;
      delete doc.relatedUsers.members;
    } else {
      doc.relatedUsers = {};
      if (await Roles.userIsInRole(user, ['manager'], companyId)) {
        doc.relatedUsers.defaultProjectManager = userId;
      } else {
        let manager = await Meteor.users.findOneAsync({['roles.' + companyId]: {$in: ['manager']}});
        doc.relatedUsers.defaultProjectManager = manager ? manager._id : null;
      }
      if (await Roles.userIsInRole(user, ['compliance_manager'], companyId)) {
        doc.relatedUsers.defaultComplianceManager = userId;
      } else {
        let compliance_manager = await Meteor.users.findOneAsync({['roles.' + companyId]: {$in: ['compliance_manager']}});
        doc.relatedUsers.defaultComplianceManager = compliance_manager ? compliance_manager._id : null;
      }
    }
    return doc
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  notifyAboutAnalysis: async function (moduleId, companyId) {
    const sender = await Meteor.userAsync();
    let users = await Meteor.users.find({
      $and: [{['roles.' + companyId]: {$exists: true}},
        {['roles.' + companyId]: 'manager'}]
    }).fetchAsync();
    let module = await Modules.findOneAsync({_id: moduleId, companyId});

    if (module && !(module.properties &&
      (module.properties.architecture === 'infrastructureModule' ||
        module.properties.architecture === 'infrastructureTemplate'))) {
      let followers = module.relatedUsers && module.relatedUsers.followers ? await Meteor.users.find({
        ['roles.' + companyId]: {$exists: true},
        '_id': {'$in': module.relatedUsers.followers}
      }).fetchAsync() : [];
      followers = _.filter(followers, function (item) {
        return _.any(users, function (user) {
          return user._id === item._id
        })
      });
      followers = followers.filter(function (user) {
        return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_NEW','EVENTS_CHANGES'])
      });
      if (followers.length > 0) {
        let analysis = await ModuleAnalysis.find({moduleId, companyId}, {sort: {date: -1}, limit: 2}).fetchAsync();
        if(analysis.length > 0){
          let lastAnalysis = analysis[0];
          let pastAnalysis = analysis[1] || {
            'statistics': {
              'licenses': 0,
              'components': 0,
              'legal': {
                'warnings': 0,
                'violations': 0
              },
              'vulnerability': {
                'warnings': 0,
                'violations': 0
              },
              'viability': {
                'warnings': 0,
                'violations': 0
              },
              'versioning': {
                'warnings': 0,
                'violations': 0
              },
              'integrity': {
                'warnings': 0,
                'violations': 0
              }
            }
          };
          let componentText = '';
          if (lastAnalysis.statistics.components > pastAnalysis.statistics.components) {
            componentText = ' - ' + Pluralize('component',
              Math.abs(lastAnalysis.statistics.components - pastAnalysis.statistics.components), true) + WERE_IDENTIFIED;
          }
          if (lastAnalysis.statistics.components < pastAnalysis.statistics.components) {
            componentText = ' - ' + Math.abs(lastAnalysis.statistics.components - pastAnalysis.statistics.components) + ' of '
              + Pluralize('component', Math.abs(pastAnalysis.statistics.components), true) + DROPPED;
          }
          if (lastAnalysis.statistics.components === pastAnalysis.statistics.components) {
            componentText = ' - amount of components not changed ('
              + Pluralize('component', lastAnalysis.statistics.components, true) + ')';
          }
          let warningsText = '';
          let lastWarnings = getWarnings(lastAnalysis);
          let pastWarnings = getWarnings(pastAnalysis);
          if (lastWarnings > pastWarnings) {
            warningsText = ' - ' + Pluralize('warning', Math.abs(lastWarnings - pastWarnings), true) + WERE_IDENTIFIED;
          }
          if (lastWarnings < pastWarnings) {
            warningsText = ' - ' + Math.abs(lastWarnings - pastWarnings) + ' of ' + Pluralize('warning',
              Math.abs(pastWarnings), true) + DROPPED;
          }
          if (lastWarnings === pastWarnings) {
            warningsText = ' - amount of warnings not changed (' + Pluralize('warning', lastWarnings, true) + ')';
          }
          let violationsText = '';
          let lastViolations = getViolations(lastAnalysis);
          let pastViolations = getViolations(pastAnalysis);
          if (lastViolations > pastViolations) {
            violationsText = ' - ' + Pluralize('violation', Math.abs(lastViolations - pastViolations), true) + WERE_IDENTIFIED;
          }
          if (lastViolations < pastViolations) {
            violationsText = ' - ' + Math.abs(lastViolations - pastViolations) + ' of ' + Pluralize('violation',
              Math.abs(pastViolations), true) + '  were dropped';
          }
          if (lastViolations === pastViolations) {
            violationsText = ' - amount of violations not changed (' + Pluralize('violation', lastViolations, true) + ')';
          }
          let vulnerabilitiesText = '';
          let lastVulnerabilities = getVulnerabilities(lastAnalysis);
          let pastVulnerabilities = getVulnerabilities(pastAnalysis);
          if (lastVulnerabilities > pastVulnerabilities) {
            vulnerabilitiesText = ' - ' + Pluralize('vulnerability',
              Math.abs(lastVulnerabilities - pastVulnerabilities), true) + WERE_IDENTIFIED;
          }
          if (lastVulnerabilities < pastVulnerabilities) {
            vulnerabilitiesText = ' - ' + Math.abs(lastVulnerabilities - pastVulnerabilities) + ' of ' + Pluralize('vulnerability',
              Math.abs(pastVulnerabilities), true) + DROPPED;
          }
          if (lastVulnerabilities === pastVulnerabilities) {
            vulnerabilitiesText = ' - amount of vulnerabilities not changed ('
              + Pluralize('vulnerability', lastVulnerabilities, true) + ')';
          }
          for (const oneUser of followers) {
            const userMailBody =
              '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
              '<p>You have requested to recieve updates on module ' + escapeHtml(module.name) + '</p>' +
              '<p>We send you this mail to inform you about new components and following changes in analysis:</p><br>' +
              '<p>A scan for module ' + escapeHtml(module.name) + ' has been processed resulting in:</p>' +
              (componentText ? '<p>' + escapeHtml(componentText) + '</p>' : '') +
              (warningsText ? '<p>' + escapeHtml(warningsText) + '</p>' : '') +
              (violationsText ? '<p>' + escapeHtml(violationsText) + '</p>' : '') +
              (vulnerabilitiesText ? '<p>' + escapeHtml(vulnerabilitiesText) + '</p>' : '') +
              '<p>Please login <a href="'+escapeHtml(Config.ROOT_URL)+'">'+escapeHtml(Config.ROOT_URL)+'</a> and arrange the according resolution.</p><br>' +
              mailFooter();
            let EVENTS_NEW = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_NEW');
            let EVENTS_CHANGES = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_CHANGES');
            let EVENTS_ALL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_ALL');
            if(!EVENTS_ALL && !EVENTS_NEW && EVENTS_CHANGES){
              let changesMessage = 'Changes in analysis: ';
              let anyChanges = false;
              if (lastAnalysis.statistics.components !== pastAnalysis.statistics.components) {
                changesMessage += componentText;
                anyChanges = true;
              }
              if (lastWarnings !== pastWarnings) {
                changesMessage += warningsText;
                anyChanges = true;
              }
              if (lastViolations !== pastViolations) {
                changesMessage += violationsText;
                anyChanges = true;
              }
              if (lastVulnerabilities !== pastVulnerabilities) {
                changesMessage += vulnerabilitiesText;
                anyChanges = true;
              }
              if(anyChanges){
                let inboxMessage = {
                  userId: oneUser._id,
                  companyId: module.companyId,
                  projectId: module.projectId,
                  moduleId: module._id,
                  message: changesMessage,
                  type: 'eventsNotifications',
                  senderId: sender && sender._id,
                  senderName: getUserName(sender)
                };
                await Meteor.callAsync(MESSAGE_CREATE, inboxMessage);
              }
            }else{
              let inboxMessage = {
                userId: oneUser._id,
                companyId: module.companyId,
                projectId: module.projectId,
                moduleId: module._id,
                message: 'New analysis: '+(componentText?componentText:'') + (warningsText?warningsText:'') +
                  (violationsText?violationsText:'') + (vulnerabilitiesText?vulnerabilitiesText:''),
                type: 'eventsNotifications',
                senderId: sender && sender._id,
                senderName: getUserName(sender)
              };
              await Meteor.callAsync(MESSAGE_CREATE, inboxMessage);
            }
            let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
            if(EVENTS_BY_EMAIL){
              await Meteor.callAsync('_sendEmail',
                ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
                'New analysis in module ' + module.name, userMailBody,
                true);
            }
          }
          await Meteor.callAsync('notifyAboutVersionJump', lastAnalysis, followers, module)
        }
      }
    }
    return true;
  },
  notifyAboutVersionJump: async function (analysis, followers, module) {
    const sender = await Meteor.userAsync();
    const hasJump = _.filter(analysis.components, (component) => {
      const versionings = component.problems && component.problems.versioning && component.problems.versioning
      return _.some(versionings, (problem) => problem && problem.extra && problem.extra.past)
    });
    if(hasJump && hasJump.length > 0){
      const comps = hasJump.map((comp)=>{
        const versionings = comp.problems && comp.problems.versioning && comp.problems.versioning
        return `<p>${escapeHtml(comp.key)} (${escapeHtml(versionings[0].extra.past)} -&gt; ${escapeHtml(versionings[0].extra.curr)})</p>`
      })
      for (const oneUser of followers) {
        const userMailBody =
          '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
          '<p>You have requested to recieve updates on module ' + escapeHtml(module.name) + '</p>' +
          '<p>We send you this mail to inform you about Version jump in components:</p>' +
          comps.join('') +
          '<br><p>Please login <a href="'+escapeHtml(Config.ROOT_URL)+'">'+escapeHtml(Config.ROOT_URL)+'</a> and arrange the according resolution.</p><br>' +
          mailFooter();

        let EVENTS = Utils.isUserNotificationAllowed(oneUser, ['EVENTS_ALL','EVENTS_CHANGES']);
        if(EVENTS){
          let inboxMessage = {
            userId: oneUser._id,
            companyId: module.companyId,
            projectId: module.projectId,
            moduleId: module._id,
            message: 'New analysis: version jump in module ' + module.name,
            type: 'eventsNotifications',
            senderId: sender && sender._id,
            senderName: getUserName(sender)
          };
          await Meteor.callAsync(MESSAGE_CREATE, inboxMessage);
          let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
          if(EVENTS_BY_EMAIL){
            await Meteor.callAsync('_sendEmail',
              ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
              'New analysis: version jump in module ' + module.name, userMailBody,
              true);
          }
        }
      }
    }
  },
  checkLicense: async function (projectId, moduleId, licenses) {
    await requireModuleAccess(this, moduleId);
    if (projectId) {
      await requireProjectAccess(this, projectId);
    }
    const project = await Projects.findOneAsync(projectId);
    const module = await Modules.findOneAsync(moduleId);
    let moduleComponents = [];
    _.each(licenses,function (licenseKey, index) {
      moduleComponents.push({
        key: 'npm:test'+index,
        name: 'test'+index,
        versions: [{
          version: '1',
          licenses: [{
            key: licenseKey
          }],
          paths: [{
            path:'/',
            params: ['isUnchanged']
          },{
            path:'/',
            params: ['isChanged']
          }]
        }]
      });
    });
    let results = [];
    try{
      let request = await runTsCheck(Utils.rebuildModuleObject(module, moduleComponents, project));
      if (request.data) {
        for (let index = 0; index < licenses.length; index++) {
          const licenseKey = licenses[index];
          const componentKey = 'npm:test'
          const notViolatedRules = await Rules.find({type: 'warning'}).fetchAsync();
          const notViolatedRulesKeys = _.map(notViolatedRules, c => c.key)
          let obligationConfig;
          if(project && project.obligationConfig){
            obligationConfig = _.extend(project.obligationConfig, module.obligationConfig);
          }else{
            obligationConfig = module.obligationConfig
          }
          let legalRulesConfig;
          if(project && project.legalRulesConfig){
            legalRulesConfig = _.extend(project.legalRulesConfig, module.legalRulesConfig);
          }else{
            legalRulesConfig = module.legalRulesConfig
          }
          results.push({
            license: licenseKey,
            not_changed: Utils.normalizeLicenseStatus(request.data[module.name]['npm:test' + index + ':1:0'][licenseKey],
              componentKey, obligationConfig, legalRulesConfig, notViolatedRulesKeys),
            changed: Utils.normalizeLicenseStatus(request.data[module.name]['npm:test' + index + ':1:1'][licenseKey],
              componentKey, obligationConfig, legalRulesConfig, notViolatedRulesKeys)
          });
        }
      }
    }catch (error) {
      console.info('=> checkLicense: ', error);
      if(error.code === 'ECONNREFUSED' || error.Error && error.Error.indexOf('ETIMEDOUT') > -1){
        throw new Meteor.Error(error, 'Service is not available');
      }else{
        throw new Meteor.Error(error,  (typeof error.reason === 'string' || error.reason instanceof String)
          ? error.reason : 'Service has internal problem');
      }
    }
    return results
  },
  checkComponent: async function (projectId, moduleId, components) {
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) {
      throw new Meteor.Error(403, AD);
    }
    return checkComponentForCompany(companyId, projectId, moduleId, components);
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  updateCollection: async function updateCollection(collection, id, attribute, data, logEvent, originalData) {
    if (typeof collection === 'string') {
      if (collection.toLowerCase() === 'modules') {
        collection = Modules;
      }else if(collection.toLowerCase() === 'projects') {
        collection = Projects;
      }else if (collection.toLowerCase() === 'companies') {
        collection = Companies;
      }
    }else{
      return false
    }
    // id must be a plain string - a selector object could update another
    // tenant's document.
    if (typeof id !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    // attribute is used as a $set field path; reject operator/prototype keys.
    if (typeof attribute !== 'string' || attribute.charAt(0) === '$'
      || attribute.split('.').some(p => p === '__proto__' || p === 'prototype' || p === 'constructor')) {
      throw new Meteor.Error(400, 'Invalid attribute');
    }
    // Enforce tenant ownership for authenticated client calls. Trusted internal
    // (server-to-server) calls have no DDP user and are allowed through.
    const callingUser = await Meteor.userAsync();
    if (callingUser) {
      const userCompanyId = callingUser.profile && callingUser.profile.companyId;
      const targetDoc = await collection.findOneAsync(id, {fields: {companyId: 1}});
      if (!targetDoc) {
        throw new Meteor.Error(404, 'Not found');
      }
      const targetCompanyId = collection === Companies ? targetDoc._id : targetDoc.companyId;
      if (!userCompanyId || targetCompanyId !== userCompanyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      // Company-wide lists apply to every project, so they need the role that
      // manages them, not just membership of the company.
      if (collection === Companies &&
        !await Roles.userIsInRole(callingUser._id, companyListRoles(attribute), userCompanyId)) {
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let filterData = _.unique(data, function(elem) { return getUniqueLink(elem) });
    let filterOriginalData = _.unique(originalData, function(elem) { return getUniqueLink(elem) });
    if (collection instanceof Mongo.Collection) {
      const setObject = {};
      setObject[attribute] = _.sortBy(filterData, 'key');
      const result = await collection.updateAsync(id, {$set: setObject});
      if (result && logEvent) {
        const user = await Meteor.userAsync();
        let doc = await collection.findOneAsync(id);
        let docName = doc.name;
        let introducedData = _.filter(filterData,function (elementData) {
          return !_.any(filterOriginalData,function (elementOriginalData) {
            return getUniqueLink(elementOriginalData) === getUniqueLink(elementData)
          })
        });
        let missedData = _.filter(filterOriginalData,function (elementData) {
          return !_.any(filterData,function (elementOriginalData) {
            return getUniqueLink(elementOriginalData) === getUniqueLink(elementData)
          })
        });
        for (const elementData of introducedData) {
          let type = '';
          let message = '';
          if(attribute.split('Config')[0] === 'component'){
            switch (attribute.split('.')[1]){
            case 'blacklist':
              message = 'Component '+elementData.key+PUT_TO_BL_FOR+docName;
              type = 'markComponentBlacklisted';
              break;
            case 'whitelist':
              message = 'Component '+elementData.key+' put to allow for '+docName;
              type = 'markComponentWhitelisted';
              break;
            case 'unchanged':
              message = 'Component '+elementData.key+' marked as unchanged for '+docName;
              type = 'markComponentUnchanged';
              break;
            case 'cots':
              message = 'Component '+elementData.key+' marked as cots for '+docName;
              type = 'markComponentCots';
              break;
            case 'looseCoupled':
              message = 'Component '+elementData.key+' marked as loosely coupled for '+docName;
              type = 'markComponentLooseCoupled';
              break;
            case 'licensesSelected':
              message = 'License '+elementData.license+' selected for component '+elementData.key +' for '+docName;
              type = 'markComponentLicensesSelected';
              break;
            }
          }else if (attribute.split('Config')[0] === 'license'){
            switch (attribute.split('.')[1]) {
            case 'blacklist':
              message = 'License '+elementData.key+PUT_TO_BL_FOR+docName;
              type = 'markLicenseBlackListed';
              break;
            case 'whitelist':
              message = 'License '+elementData.key+' put to allow for '+docName;
              type = 'markLicenseWhiteListed';
              break;
            }
          }else if (attribute.split('Config')[0] === 'cve'){
            switch (attribute.split('.')[1]) {
            case 'blacklist':
              message = elementData.cveKey+PUT_TO_BL_FOR + elementData.key+' '+elementData.version + ' in '+docName;
              type = 'markCveBlackListed';
              break;
            case 'whitelist':
              message = elementData.cveKey+' muted for ' + elementData.key+' '+elementData.version + ' in '+docName;
              type = 'markCveWhiteListed';
              break;
            }
          }else if (attribute.split('Config')[0] === 'obligation'){
            const obligation = await Constraints.findOneAsync({key: elementData.obligationKey})
            message = obligation.name +' resolved ' + (elementData.key ? 'for '+ elementData.key : '') +' in '+docName;
            type = 'markObligationResolved'
          }else if (attribute.split('Config')[0] === 'legalRules'){
            const rule = await Rules.findOneAsync({key: elementData.ruleKey})
            message = rule.message +' resolved ' + (elementData.key ? 'for '+ elementData.key : '') +' in '+docName;
            type = 'markLegalRuleResolved'
          }else if (attribute.split('Config')[0] === 'algorithms'){
            message = elementData.key+' updated in '+docName;
            type = 'markAlgorithmsListed'
          }
          type = type || Utils.camelize('mark ' + attribute.split('Config')[0] + ' ' + (attribute.split('.')[1] || 'list') +
              ((attribute.indexOf('license')> -1)?'':'ed'));
          await Meteor.callAsync('logEvent', user, message, type);
        }
        for (const elementData of missedData) {
          let type = '';
          let message = '';
          if(attribute.split('Config')[0] === 'component'){
            switch (attribute.split('.')[1]){
            case 'blacklist':
              message = 'Component '+elementData.key+REMOVE_FROM_BL_FOR+docName;
              type = 'markComponentBlacklisted';
              break;
            case 'whitelist':
              message = 'Component '+elementData.key+' removed from allowed for '+docName;
              type = 'markComponentWhitelisted';
              break;
            case 'unchanged':
              message = 'Component '+elementData.key+' marked as changed for '+docName;
              type = 'markComponentUnchanged';
              break;
            case 'cots':
              message = 'Component '+elementData.key+' marked as os for '+docName;
              type = 'markComponentCots';
              break;
            case 'looseCoupled':
              message = 'Component '+elementData.key+' marked as tightly coupled for '+docName;
              type = 'markComponentLooseCoupled';
              break;
            case 'licensesSelected':
              message = 'License '+elementData.license+' removed from component '+elementData.key +' for '+docName;
              type = 'markComponentLicensesSelected';
              break;
            }
          }else if (attribute.split('Config')[0] === 'license'){
            switch (attribute.split('.')[1]) {
            case 'blacklist':
              message = 'License '+elementData.key+REMOVE_FROM_BL_FOR+docName;
              type = 'markLicenseBlackListed';
              break;
            case 'whitelist':
              message = 'License '+elementData.key+' removed from allowed for '+docName;
              type = 'markLicenseWhiteListed';
              break;
            }
          }else if (attribute.split('Config')[0] === 'cve'){
            switch (attribute.split('.')[1]) {
            case 'blacklist':
              message = elementData.cveKey+REMOVE_FROM_BL_FOR + elementData.key+' '+elementData.version + ' in '+docName;
              type = 'markCveBlackListed';
              break;
            case 'whitelist':
              message = elementData.cveKey+' unmuted for ' + elementData.key+' '+elementData.version + ' in '+docName;
              type = 'markCveWhiteListed';
              break;
            }
          }else if (attribute.split('Config')[0] === 'obligation'){
            const obligation = await Constraints.findOneAsync({key:elementData.obligationKey})
            message = obligation.name +' unresolved ' + (elementData.key ? 'for '+ elementData.key : '') +' in '+docName;
            type = 'markObligationResolved'
          }else if (attribute.split('Config')[0] === 'legalRules'){
            const rule = await Rules.findOneAsync({key:elementData.ruleKey})
            message = rule.message +' unresolved ' + (elementData.key ? 'for '+ elementData.key : '') +' in '+docName;
            type = 'markLegalRuleResolved'
          }else if (attribute.split('Config')[0] === 'algorithms'){
            message = elementData.key+' updated in '+docName;
            type = 'markAlgorithmsListed'
          }
          type = type || Utils.camelize('mark ' + attribute.split('Config')[0] + ' ' + (attribute.split('.')[1] || 'list') +
              ((attribute.indexOf('license')> -1)?'':'ed'));
          await Meteor.callAsync('logEvent', user, message, type);
        }
      }
    }
  },
  countProjectModules: async function (projectId) {
    const user = await Meteor.userAsync();
    if(user){
      const companyId = user.profile.companyId;
      let filter = {
        companyId, projectId
      };
      if(projectId === Projects.UNASSIGNED){
        filter.projectId = {$exists: false}
      }
      return await Modules.find(filter,{fields:{name:1}}).countAsync()
    }
    return 0
  },
  bulkUpdateModuleLegalSettings: async function (moduleId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
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
  bulkUpdateMyModuleLegalSettings: async function (moduleId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {requirements}}, {multi: true});
  },
  bulkUpdateProjectModuleLegalSettings: async function (moduleId, projectId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { projectId },
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
  bulkUpdateMyProjectModuleLegalSettings: async function (moduleId, projectId, requirements) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { projectId },
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {requirements}}, {multi: true});
  },
  bulkUpdateModuleObligationSettings: async function (moduleId, obligationConfig) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {obligationConfig}}, {multi: true});
  },
  bulkUpdateMyModuleObligationSettings: async function (moduleId, obligationConfig) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {obligationConfig}}, {multi: true});
  },
  bulkUpdateProjectModuleObligationSettings: async function (moduleId, projectId, obligationConfig) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { projectId },
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {obligationConfig}}, {multi: true});
  },
  bulkUpdateMyProjectModuleObligationSettings: async function (moduleId, projectId, obligationConfig) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    return await Modules.updateAsync({
      $and: [
        {_id: {$ne: moduleId}},
        { companyId },
        { projectId },
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}, {$set: {obligationConfig}}, {multi: true});
  },
  getPortfolioOverview: async function (projectId, moduleIds) {
    let statsArr = [];
    const userId = this.userId;
    const companyId = await Utils.getCompanyIdForUserAsync(userId);
    let filter = {
      companyId: companyId
    };
    if(projectId){
      filter._id = projectId;
    }
    const projects = await Projects.find(filter).fetchAsync();
    for (const project of projects) {
      let filter = {
        companyId: companyId,
        projectId: project._id
      };
      if(moduleIds){
        filter._id = { $in : moduleIds}
      }
      const modules = await Modules.find(filter).fetchAsync();
      for (const element of modules) {
        const statistic = element.getStatistics();
        const {warnings, violations} = statistic.getSummary();
        statistic.summary = {warnings, violations}
        statsArr.push({
          _id: element._id,
          title: element.getName(),
          project: project.getName(),
          projectId: project._id,
          components: statistic.components,
          licenses: statistic.licenses,
          stats: statistic
        })
      }
    }
    return statsArr;
  },
  getImpactComponent: async function ({_id, key, version, name, description}) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if(!key){
      throw new Meteor.Error(400, 'Component key is required');
    }
    let filter = {
      $or:[{latest: true},{released: true}],
      companyId,
      'components.key': key
    };
    if(version){
      filter['components.versions.version'] = version
    }
    let modules, projects;
    let analysis = await ModuleAnalysis.find(filter, { fields: {components: 1, moduleId: 1, latest: 1, released: 1, companyId: 1,
      date: 1, tag: 1, branch: 1, release: 1}}).fetchAsync()
    if(analysis && analysis.length > 0){
      const moduleIds = analysis.map(function (item){
        return item.moduleId
      })
      modules = await Modules.find({_id: {$in: moduleIds}, companyId},
        { fields: {relatedUsers: 1, name: 1, projectId: 1, properties: 1}}).fetchAsync()
      if(modules && modules.length > 0){
        modules = modules.map(function (module){
          module.analysis = analysis.find(function (item){
            return item.moduleId === module._id
          })
          module.componentKey = key
          return module
        })
        const projectIds = modules.map(function (item){
          return item.projectId
        })
        projects = await Projects.find({_id: {$in: projectIds}, companyId},
          { fields: {relatedUsers: 1, name: 1, description: 1}}).fetchAsync()
        let projectsList = [];
        for (const project of projects) {
          const {_id, name, description, relatedUsers} = project;
          let projectObj = {_id, name, description, relatedUsers: {}};
          if(relatedUsers){
            projectObj.relatedUsers.defaultProjectManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultProjectManager, {fields:{profile:1}});
            projectObj.relatedUsers.defaultComplianceManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultComplianceManager, {fields:{profile:1}});
          }
          projectObj.modules = modules.filter(function (module){
            return module.projectId === _id
          })
          projectsList.push(projectObj)
        }
        projects = projectsList;
      }
      let modulesWithoutProject = modules.filter(function (module){
        return !module.projectId
      })
      if(modulesWithoutProject && modulesWithoutProject.length){
        projects.push({name: 'Unassigned Modules', _id: Projects.UNASSIGNED, modules: modulesWithoutProject})
      }
    }
    return {
      list : projects || [],
      companyId,
      component : {_id, key, version, name, description}
    };
  },
  getImpactCve: async function (cveId, extCompanyId) {
    const user = await Meteor.userAsync();
    // extCompanyId is for the REST report, which resolves the company from the
    // API key on the server. A client call always reports on its own company:
    // honouring the argument there handed any caller another company's
    // affected projects and modules.
    const restCompanyId = this.connection ? undefined : extCompanyId;
    const companyId = restCompanyId || user && user.profile && user.profile.companyId;
    if(typeof cveId !== 'string' || !cveId){
      throw new Meteor.Error(400, 'CVE ID is required');
    }
    // Both callers (the report form and the REST endpoint) upper-case the whole identifier,
    // which is right for a CVE id but destroys a GHSA one: those are canonically
    // `GHSA-` + lowercase suffix and the vulnerability service matches them case-sensitively.
    // An upper-cased suffix still answers 200, with an empty stub carrying no description,
    // score or weakness - so the report found the impacted projects but could never explain
    // the advisory. Restore the canonical form before it is used for the upstream lookup and
    // for the whitelist comparisons below, which are case-sensitive too.
    cveId = normalizeVulnerabilityId(cveId);
    let filter = {
      companyId,
      $or:[{latest: true},{released: true}],
      components : {
        $elemMatch: {
          'problems.vulnerability': {
            $elemMatch: {
              'message': containsTextRegex(cveId)
            }
          }
        }
      }
    };
    let modules, projects;
    let analysis = await ModuleAnalysis.find(filter, { fields: {components: 1, moduleId: 1, latest: 1, released: 1, companyId: 1,
      date: 1, tag: 1, branch: 1, release: 1}}).fetchAsync()
    if(analysis && analysis.length > 0){
      const moduleIds = analysis.map(function (item){
        return item.moduleId
      })
      modules = await Modules.find({_id: {$in: moduleIds}, companyId},{ fields:
          {relatedUsers: 1, name: 1, projectId: 1, properties: 1, cveConfig: 1}}).fetchAsync()
      if(modules && modules.length > 0){
        modules = modules.map(function (module){
          module.analysis = analysis.find(function (item){
            return item.moduleId === module._id
          })
          module.cveId = cveId
          module.cveConfig = module.cveConfig && module.cveConfig.whitelist.filter(function (item){
            return item.cveKey === cveId
          })
          return module
        })
        const projectIds = modules.map(function (item){
          return item.projectId
        })
        projects = await Projects.find({_id: {$in: projectIds}, companyId},{ fields:
            {relatedUsers: 1, name: 1, description: 1, cveConfig: 1}}).fetchAsync()
        let projectsList = [];
        for (const project of projects) {
          const {_id, name, description, relatedUsers} = project;
          let projectObj = {_id, name, description, relatedUsers: {}};
          if(relatedUsers){
            projectObj.relatedUsers.defaultProjectManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultProjectManager, {fields:{profile:1}});
            projectObj.relatedUsers.defaultComplianceManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultComplianceManager, {fields:{profile:1}});
          }
          projectObj.modules = modules.filter(function (module){
            return module.projectId === _id
          })
          projectObj.cveConfig = projectObj.cveConfig && projectObj.cveConfig.whitelist.filter(function (item){
            return item.cveKey === cveId
          })
          projectsList.push(projectObj)
        }
        projects = projectsList;
      }
      let modulesWithoutProject = modules.filter(function (module){
        return !module.projectId
      })
      if(modulesWithoutProject && modulesWithoutProject.length){
        projects.push({name: 'Unassigned Modules', _id: Projects.UNASSIGNED, modules: modulesWithoutProject})
      }
    }
    let cveInfo = {
      name: cveId
    };
    const cveResponse = await Meteor.callAsync('tsVulnerabilityCveDetails', {cves: [cveId]}, restCompanyId)
    if(cveResponse && cveResponse.data && cveResponse.data.cves){
      const cveDetails = cveResponse.data.cves[0]
      if(cveDetails){
        const impact = Utils.groupedImpactVersions(cveDetails.impact)
        let v2 = impact && impact.cvss2 && impact.cvss2.baseScore
        let v3 = impact && impact.cvss3 && impact.cvss3.baseScore
        let v4 = impact && impact.cvss4 && impact.cvss4.baseScore
        cveInfo = {
          cwe: true,
          cvssScore: v4 || v3 || v2,
          weakness: cveDetails.weakness,
          impact,
          description: cveDetails.description,
          lastmodified: cveDetails.lastmodified,
          references: cveDetails.references,
          name: cveDetails.cve_id
        }
      }
    }
    return {
      list : projects || [],
      companyId,
      cveDetails : cveInfo
    };
  },
  getImpactAlgorithm: async function ({Algorithm, Strength}) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId;
    if(!Algorithm){
      throw new Meteor.Error(400, 'Algorithm is required');
    }
    const projects = await Projects.find({companyId}, {fields: {companyId: 1, relatedUsers: 1, name: 1, description: 1}}).fetchAsync();
    let list = []
    if(projects && projects.length > 0){
      for (const project of projects) {
        let report = await Meteor.callAsync('getProjectAlgorithmsShort', project._id, companyId)
        if(report && report.length > 0 && report.find(item=>{
          return item.algorithm.toLowerCase() === Algorithm.toLowerCase()
        })){
          const {_id, name, description, relatedUsers} = project;
          let projectObj = {_id, name, description, relatedUsers: {}};
          if(relatedUsers){
            projectObj.relatedUsers.defaultProjectManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultProjectManager, {fields:{profile:1}});
            projectObj.relatedUsers.defaultComplianceManager =
              await Meteor.users.findOneAsync(relatedUsers.defaultComplianceManager, {fields:{profile:1}});
          }
          list.push(projectObj)
        }
      }
    }
    return {
      list : list || [],
      companyId,
      algorithm : {Algorithm, Strength}
    };
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawModules;

Meteor.startup(function () {
  RawModules = Utils.makeRawCollection(Modules);
  RawModules.createIndex('companyId');
});

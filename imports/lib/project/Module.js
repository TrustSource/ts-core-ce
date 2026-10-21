import { Meteor } from 'meteor/meteor';
import _ from 'underscore';
import {
  ModuleSchema, ModuleViabilityConfigSchema, ModuleVersioningConfigSchema, ModuleSchemaBasicSettings
}
  from '/imports/lib/schemas/moduleSchema';
import {RequirementsSchema} from '/imports/lib/schemas/requirementsModuleSchema';
import {CIARequirementsSchema} from '/imports/lib/schemas/CIARequirementsSchema';
import Statistics from './Statistics';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Analysis from '/imports/lib/project/Analysis';
import Utils from '/imports/lib/utils';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';

const Module = function (docOrCompanyId, moduleName, moduleIdentifier, projectId, demo) {
  if (!moduleName && !moduleIdentifier) {
    _.extend(this, docOrCompanyId);
  } else {
    this.companyId = docOrCompanyId;
    this.name = moduleName;
    this.moduleIdentifier = moduleIdentifier || moduleName;
    if (projectId) {
      this.projectId = projectId;
    }
    if (demo) {
      this.demo = demo;
    }
    this.viabilityConfig = {
      warningThreshold: 1,
      violationThreshold: 1,
      minConfidence: 1,
      noInfoLevel: 1
    };
    this.versioningConfig = {
      jump: true,
      warningThreshold: 3,
      violationThreshold: 1
    };
    this.componentConfig = {
      looseCoupled: [],
      unchanged: [],
      changedStatus: [],
      whitelist: [],
      blacklist: []
    };
    this.properties = {
      privacy: 'private',
      architecture: 'sourceCode'
    }
  }
};

export default Module;

Module.prototype.getName = function () {
  return this.name || 'anonymous';
};

Module.prototype.getVersion = function () {
  return this.version || '';
};

Module.prototype.validate = function () {
  const context = ModuleSchema.newContext();

  // convert Module to bare Object, validation only works this way
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

Module.prototype.isComponentBlacklisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.blacklist;
  return Utils.findCompInArray(array, key, version, false);
};
Module.prototype.isComponentWhitelisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.whitelist;
  return Utils.findCompInArray(array, key, version, true);
};
Module.prototype.isComponentUnchanged = function (key, version, path) {
  const array = this.componentConfig && this.componentConfig.unchanged;
  return Utils.findCompInArray(array, key, version, true, path);
};
Module.prototype.isComponentChangedStatus = function (key) {
  const array = this.componentConfig && this.componentConfig.changedStatus;
  return Utils.findCompInArray(array, key, '*', true);
};
Module.prototype.isComponentLooseCoupled = function (key, version, path) {
  const array = this.componentConfig && this.componentConfig.looseCoupled;
  return Utils.findCompInArray(array, key, version, true, path);
};
Module.prototype.isComponentCots = function (key, version, path) {
  const array = this.componentConfig && this.componentConfig.cots;
  return Utils.findCompInArray(array, key, version, true, path);
};
Module.prototype.isLicenseSelected = function (key, version, path, selectedLicense) {
  const array = this.componentConfig && this.componentConfig.licensesSelected;
  return Utils.findCompInArray(array, key, version, true, path, selectedLicense);
};
Module.prototype.isLicenseBlacklisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};
Module.prototype.isLicenseWhitelisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};
Module.prototype.isCveWhitelisted = function (cveKey, key, version, path) {
  const array = this.cveConfig && this.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Module.prototype.getCompletedObligations = function () {
  return this.obligationConfig  || [];
};

Module.prototype.isConstraintResolved = function (obligationKey, key, version, path) {
  const array = this.obligationConfig ;
  const resolution = _.find(array, function (entry) {
    return entry.obligationKey === obligationKey && (key && entry.key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  })
  if(resolution){
    resolution.type = !resolution.key ? 'module' : false
  }
  return resolution;
};

Module.prototype.getCompletedLegalRules = function () {
  return this.legalRulesConfig  || [];
};

Module.prototype.isLegalRuleResolved = function (ruleKey, key, version, path) {
  const array = this.legalRulesConfig ;
  const resolution = _.find(array, function (entry) {
    return entry.ruleKey === ruleKey && (key && entry.key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  })
  if(resolution){
    resolution.type = !resolution.key ? 'module' : false
  }
  return resolution;
};

const componentKeyOpts = {component: true, version: true};

Module.prototype.componentsChanged = function (compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new Utils.ComponentKey(comp, componentKeyOpts);
      return this.isComponentUnchanged(key.component, key.version);
    }, this);
  }
  return true;
};

Module.prototype.componentsChangedStatus = function (compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new Utils.ComponentKey(comp, componentKeyOpts);
      return this.isComponentChangedStatus(key.component, '*');
    }, this);
  }
  return true;
};

Module.prototype.componentsTightCoupled = function (compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new Utils.ComponentKey(comp, componentKeyOpts);
      return this.isComponentLooseCoupled(key.component, key.version);
    }, this);
  }
  return true;
};

Module.prototype.componentsCots = function (compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new Utils.ComponentKey(comp, componentKeyOpts);
      return this.isComponentCots(key.component, key.version);
    }, this);
  }
  return true;
};

Module.prototype.licensesSelected = function (compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new Utils.ComponentKey(comp, componentKeyOpts);
      return this.isLicenseSelected(key.component, key.version);
    }, this);
  }
  return true;
};

// Only the `analysis` collection carries a transform, so a document reaching us any
// other way is a plain object with no prototype: the publication denormalises the
// latest analysis onto `module.analysis[0]`, `analysisObj` is assigned from a method
// result, and a DDP method result is never transformed either. Callers expect an
// Analysis - `analysis.getTotalComponentCnt()` threw on the module vulnerability and
// viability views - so every return path is normalised here.
function toAnalysis(doc) {
  if (!doc || doc instanceof Analysis) {
    return doc;
  }
  return new Analysis(doc);
}

Module.prototype.getAnalysis = function (release, analysisId) {
  let filter= {
    moduleId: this._id
  };
  if(this.companyId){
    filter.companyId = this.companyId;
  }
  if(release){
    filter.release = release;
  }
  if(analysisId){
    filter._id = analysisId;
  }
  if(this.analysisObj && this.analysisObj._id === analysisId){
    return toAnalysis(this.analysisObj)
  } else if((analysisId && this.analysis && this.analysis[0] === analysisId) ||
    (!analysisId && this.analysis && this.analysis[0])){
    return toAnalysis(this.analysis[0])
  } else {
    if (Meteor.isServer) {
      return null; // Use getAnalysisAsync() on server
    }
    const analysis = ModuleAnalysis.findOne(filter, {sort: {'date': -1}});
    if(analysis){
      return analysis
    }else if (analysisId){
      try {
        return toAnalysis(ReactiveMethod.call('getAnalysis', analysisId))
        // eslint-disable-next-line no-empty, sonarjs/no-ignored-exceptions
      }catch (e){

      }
    }
  }
};

Module.prototype.getAnalysisAsync = async function (release, analysisId) {
  let filter = { moduleId: this._id };
  if (this.companyId) filter.companyId = this.companyId;
  if (release) filter.release = release;
  if (analysisId) filter._id = analysisId;
  if (this.analysisObj && this.analysisObj._id === analysisId) {
    return toAnalysis(this.analysisObj);
  } else if ((analysisId && this.analysis && this.analysis[0] === analysisId) ||
    (!analysisId && this.analysis && this.analysis[0])) {
    return toAnalysis(this.analysis[0]);
  } else {
    const analysis = await ModuleAnalysis.findOneAsync(filter, {sort: {'date': -1}});
    if (analysis) return analysis;
    return null;
  }
};

Module.prototype.getStatistics = function (analysisId) {
  const newAnalysisId = analysisId ? analysisId : this.analysisId || null;
  let data = {
    licenses: 0,
    components: 0,
    legal: {
      warnings: 0,
      violations: 0
    },
    vulnerability: {
      warnings: 0,
      violations: 0
    },
    versioning: {
      warnings: 0,
      violations: 0
    },
    viability: {
      warnings: 0,
      violations: 0
    },
    integrity: {
      warnings: 0,
      violations: 0
    },
    overall: {
      warnings: 0,
      violations: 0
    },
    encryption: {
      warnings: 0,
      violations: 0
    }
  };
  if(this.statistics && (this.statistics.analysisId === newAnalysisId || !newAnalysisId)){
    data = this.statistics;
  }else{
    const analysis = this.getAnalysis(null, newAnalysisId);
    if(analysis && analysis.statistics){
      data = analysis.statistics
    }
  }
  return new Statistics(data);
};

Module.prototype.getQuality = function () {
  let data = {
    ok: 0,
    warnings: 0,
    violations: 0,
    total: 0
  };
  let tools = this.quality && this.quality.tools;
  return Utils.extendQualityStats(data, tools);
};

Module.prototype.getAllComponents = function (release, analysisId) {
  const analysis = this.getAnalysis(release, analysisId);
  if (analysis) {
    if (typeof analysis.getAllComponents === 'function') {
      return analysis.getAllComponents();
    }
    if (analysis.components) {
      return analysis.components;
    }
  }
  return [];
};

Module.prototype.getAllComponentsAsync = async function (release, analysisId) {
  const analysis = await this.getAnalysisAsync(release, analysisId);
  if (analysis) {
    if (typeof analysis.getAllComponents === 'function') {
      return analysis.getAllComponents();
    }
    if (analysis.components) {
      return analysis.components;
    }
  }
  return [];
};

Module.prototype.getLicenseRating = function (licKey) {
  const analysis = this.getAnalysis();
  return analysis && analysis.getLicenseRating(licKey);
};

Module.prototype.getScanId = function () {
  const analysis = this.getAnalysis();
  return analysis && analysis.scanId;
};

// Server-safe variant: getAnalysis() returns null on the server, so callers that
// run server-side (e.g. SPDX/SBOM export building the component tree) must await
// this to obtain the scan id.
Module.prototype.getScanIdAsync = async function () {
  const analysis = await this.getAnalysisAsync();
  return analysis && analysis.scanId;
};

Module.prototype.getWhitelistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.whitelist || [];
};

Module.prototype.getBlacklistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.blacklist || [];
};

Module.prototype.getWhitelistedCve = function () {
  return this.cveConfig && this.cveConfig.whitelist || [];
};

Module.prototype.getBlacklistedCve = function () {
  return this.cveConfig && this.cveConfig.blacklist || [];
};

Module.prototype.getWhitelistedComponents = function () {
  return this.componentConfig && this.componentConfig.whitelist || [];
};

Module.prototype.getBlacklistedComponents = function () {
  return this.componentConfig && this.componentConfig.blacklist || [];
};

Module.prototype.getUnchangedComponents = function () {
  return this.componentConfig && this.componentConfig.unchanged || [];
};
Module.prototype.getChangedStatusComponents = function () {
  return this.componentConfig && this.componentConfig.changedStatus || [];
};

Module.prototype.getLooseCoupledComponents = function () {
  return this.componentConfig && this.componentConfig.looseCoupled || [];
};

Module.prototype.getLicenseSelected = function () {
  return this.componentConfig && this.componentConfig.licensesSelected || [];
};

Module.prototype.getCotsComponents = function () {
  return this.componentConfig && this.componentConfig.cots || [];
};

Module.prototype.getJiraIntegrations = function () {
  return this.jira || [];
};

Module.prototype.getGithubIntegrations = function () {
  return this.github || [];
};

Module.prototype.getTfsIntegrations = function () {
  return this.tfs || [];
};

Module.prototype.generalSettingsValid = function () {
  const ctx = ModuleSchemaBasicSettings.newContext();
  ctx.validate(_.pick(this, '_id', 'companyId', 'name', 'description'));
  return ctx.isValid();
};

Module.prototype.viabilitySettingsValid = function () {
  if (this && this.properties && this.properties.architecture !== 'infrastructureModule' &&
    this.properties.architecture !== 'infrastructureTemplate' &&
    this.properties.architecture !== 'cotsModule' &&
    this.properties.architecture !== 'cotsTemplate') {
    return !!(this.viabilityConfig && ModuleViabilityConfigSchema.newContext().validate(this.viabilityConfig));
  } else if (!this.properties) {
    return !!(this.viabilityConfig && ModuleViabilityConfigSchema.newContext().validate(this.viabilityConfig));
  } else {
    return true
  }
};

Module.prototype.legalSettingsValid = function () {
  if (this && this.properties && this.properties.architecture !== 'infrastructureModule' &&
      this.properties.architecture !== 'infrastructureTemplate' &&
      this.properties.architecture !== 'cotsModule' &&
      this.properties.architecture !== 'cotsTemplate') {
    return !!(this.requirements && RequirementsSchema.newContext().validate(this.requirements));
  } else if (!this.properties) {
    return !!(this.requirements && RequirementsSchema.newContext().validate(this.requirements));
  } else {
    return true
  }
};

Module.prototype.ciaSettingsValid = function () {
  if (this && this.properties && this.properties.architecture !== 'infrastructureModule' &&
    this.properties.architecture !== 'infrastructureTemplate' &&
    this.properties.architecture !== 'cotsModule' &&
    this.properties.architecture !== 'cotsTemplate') {
    return !!(this.ciaRequirements && CIARequirementsSchema.newContext().validate(this.ciaRequirements));
  } else if (!this.properties) {
    return !!(this.ciaRequirements && CIARequirementsSchema.newContext().validate(this.ciaRequirements));
  } else {
    return true
  }
};

Module.prototype.versioningSettingsValid = function () {
  if (this && this.properties && this.properties.architecture !== 'infrastructureModule' &&
    this.properties.architecture !== 'infrastructureTemplate' &&
    this.properties.architecture !== 'cotsModule' &&
    this.properties.architecture !== 'cotsTemplate') {
    return !!(this.versioningConfig && ModuleVersioningConfigSchema.newContext().validate(this.versioningConfig));
  } else if (!this.properties) {
    return !!(this.versioningConfig && ModuleVersioningConfigSchema.newContext().validate(this.versioningConfig));
  } else {
    return true
  }
};

Module.prototype.settingsValid = function () {
  return this.generalSettingsValid() && this.legalSettingsValid();
};

Module.prototype.getReleases = function () {
  return this.release || [];
};

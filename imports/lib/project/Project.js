import _ from 'underscore';
import Utils from '/imports/lib/utils';
import {RequirementsSchema} from '/imports/lib/schemas/requirementsProjectSchema';
import {CIARequirementsSchema} from '/imports/lib/schemas/CIARequirementsSchema';

const Project = function (docOrCompanyId, projectName) {

  if (!projectName) {
    _.extend(this, docOrCompanyId);
  }
  else {
    this.companyId = docOrCompanyId;
    this.name = projectName;
  }
};

export default Project;

Project.prototype.getName = function () {
  return this.name || 'anonymous';
};

Project.prototype.getWhitelistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.whitelist || [];
};

Project.prototype.getBlacklistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.blacklist || [];
};

Project.prototype.getWhitelistedCve = function () {
  return this.cveConfig && this.cveConfig.whitelist || [];
};

Project.prototype.getBlacklistedCve = function () {
  return this.cveConfig && this.cveConfig.blacklist || [];
};

Project.prototype.getWhitelistedComponents = function () {
  return this.componentConfig && this.componentConfig.whitelist || [];
};


Project.prototype.getBlacklistedComponents = function () {
  return this.componentConfig && this.componentConfig.blacklist || [];
};

Project.prototype.isComponentBlacklisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.blacklist;
  return Utils.findCompInArray(array, key, version, false);
};

Project.prototype.isComponentWhitelisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.whitelist;
  return Utils.findCompInArray(array, key, version, true);
};

Project.prototype.isLicenseBlacklisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};

Project.prototype.isLicenseWhitelisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};

Project.prototype.isCveWhitelisted = function (cveKey, key, version, path) {
  const array = this.cveConfig && this.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Project.prototype.getCompletedObligations = function () {
  return this.obligationConfig  || [];
};

Project.prototype.isConstraintResolved = function (obligationKey, key, version, path) {
  const array = this.obligationConfig ;
  const resolution = _.find(array, function (entry) {
    return entry.obligationKey === obligationKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  })
  if(resolution){
    resolution.type = !resolution.key ? 'project' : false
  }
  return resolution;
};

Project.prototype.getCompletedLegalRules = function () {
  return this.legalRulesConfig  || [];
};

Project.prototype.isLegalRuleResolved = function (ruleKey, key, version, path) {
  const array = this.legalRulesConfig ;
  const resolution = _.find(array, function (entry) {
    return entry.ruleKey === ruleKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  })
  if(resolution){
    resolution.type = !resolution.key ? 'project' : false
  }
  return resolution;
};

Project.prototype.legalSettingsValid = function () {
  if (this.properties && this.properties.architecture !== 'infrastructureModule'
      && this.properties.architecture !== 'infrastructureTemplate') {
    return !!(this.requirements && RequirementsSchema.newContext().validate(this.requirements));
  } else if (!this.properties) {
    return !!(this.requirements && RequirementsSchema.newContext().validate(this.requirements));
  } else {
    return true
  }
};

Project.prototype.ciaSettingsValid = function () {
  if (this.properties && this.properties.architecture != 'infrastructureModule'
    && this.properties.architecture != 'infrastructureTemplate') {
    return !!(this.ciaRequirements && CIARequirementsSchema.newContext().validate(this.ciaRequirements));
  } else if (!this.properties) {
    return !!(this.ciaRequirements && CIARequirementsSchema.newContext().validate(this.ciaRequirements));
  } else {
    return true
  }
};

Project.prototype.getReleases = function () {
  return this.release || [];
};

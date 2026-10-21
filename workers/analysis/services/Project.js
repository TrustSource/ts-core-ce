import _ from 'underscore';
import { Utils } from './Utils.js';

const Project = {};

Project.getWhitelistedLicenses = function (project) {
  return project.licenseConfig && project.licenseConfig.whitelist || [];
};

Project.getBlacklistedLicenses = function (project) {
  return project.licenseConfig && project.licenseConfig.blacklist || [];
};

Project.getWhitelistedCve = function (project) {
  return project.cveConfig && project.cveConfig.whitelist || [];
};

Project.getBlacklistedCve = function (project) {
  return project.cveConfig && project.cveConfig.blacklist || [];
};

Project.getWhitelistedComponents = function (project) {
  return project.componentConfig && project.componentConfig.whitelist || [];
};


Project.getBlacklistedComponents = function (project) {
  return project.componentConfig && project.componentConfig.blacklist || [];
};

Project.isComponentBlacklisted = function (project, key, version) {
  const array = project.componentConfig && project.componentConfig.blacklist;
  return Utils.findCompInArray(array, key, version, false);
};

Project.isComponentWhitelisted = function (project, key, version) {
  const array = project.componentConfig && project.componentConfig.whitelist;
  return Utils.findCompInArray(array, key, version, true);
};

Project.isLicenseBlacklisted = function (project, licKey) {
  const lc = project.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};

Project.isLicenseWhitelisted = function (project, licKey) {
  const lc = project.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};

Project.isCveWhitelisted = function (project, cveKey, key, version, path) {
  const array = project.cveConfig && project.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Project.isCveBlacklisted = function (project, cveKey, key, version, path) {
  const array = project.cveConfig && project.cveConfig.blacklist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

export {
  Project
};

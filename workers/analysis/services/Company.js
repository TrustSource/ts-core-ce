import _ from 'underscore';
import { Utils } from './Utils.js';

let Company = {};

Company.getWhitelistedLicenses = function (company) {
  return company.licenseConfig && company.licenseConfig.whitelist || [];
};

Company.getBlacklistedLicenses = function (company) {
  return company.licenseConfig && company.licenseConfig.blacklist || [];
};

Company.getWhitelistedCve = function (company) {
  return company.cveConfig && company.cveConfig.whitelist || [];
};

Company.getBlacklistedCve = function (company) {
  return company.cveConfig && company.cveConfig.blacklist || [];
};

Company.getWhitelistedComponents = function (company) {
  return company.componentConfig && company.componentConfig.whitelist || [];
};

Company.getBlacklistedComponents = function (company) {
  return company.componentConfig && company.componentConfig.blacklist || [];
};

Company.isComponentBlacklisted = function (company, key, version) {
  const array = company.componentConfig && company.componentConfig.blacklist;
  return Utils.findCompInArray(array, key, version, false);
};

Company.isComponentWhitelisted = function (company, key, version) {
  const array = company.componentConfig && company.componentConfig.whitelist;
  return Utils.findCompInArray(array, key, version, true);
};

Company.isCveWhitelisted = function (company, cveKey, key, version, path) {
  const array = company.cveConfig && company.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Company.isCveBlacklisted = function (company, cveKey, key, version, path) {
  const array = company.cveConfig && company.cveConfig.blacklisted;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Company.isLicenseBlacklisted = function (company, licKey) {
  const lc = company.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};

Company.isLicenseWhitelisted = function (company, licKey) {
  const lc = company.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};

export { Company };

import _ from 'underscore';
import CompanyStats from '/imports/lib/company/CompanyStats';
import {CompanySchema} from '/imports/lib/schemas/companySchema';
import Utils from '/imports/lib/utils';

const Company = function (doc) {
  _.extend(this, doc);
};

Company.prototype.getCompanyStats = function (index) {
  if (this.statistics && this.statistics.length) {
    if (index === undefined || index >= this.statistics.length) {
      index = this.statistics.length - 1;
    }
    return new CompanyStats(this, this.statistics[index]);
  }
  return null;
};

Company.prototype.validate = function () {
  const context = CompanySchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default Company;

Company.prototype.getWhitelistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.whitelist || [];
};

Company.prototype.getBlacklistedLicenses = function () {
  return this.licenseConfig && this.licenseConfig.blacklist || [];
};

Company.prototype.getWhitelistedCve = function () {
  return this.cveConfig && this.cveConfig.whitelist || [];
};

Company.prototype.getBlacklistedCve = function () {
  return this.cveConfig && this.cveConfig.blacklist || [];
};

Company.prototype.getWhitelistedComponents = function () {
  return this.componentConfig && this.componentConfig.whitelist || [];
};

Company.prototype.getBlacklistedComponents = function () {
  return this.componentConfig && this.componentConfig.blacklist || [];
};

Company.prototype.isComponentBlacklisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.blacklist;
  return Utils.findCompInArray(array, key, version, false);
};

Company.prototype.isComponentWhitelisted = function (key, version) {
  const array = this.componentConfig && this.componentConfig.whitelist;
  return Utils.findCompInArray(array, key, version, true);
};

Company.prototype.isCveWhitelisted = function (cveKey, key, version, path) {
  const array = this.cveConfig && this.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

Company.prototype.isLicenseBlacklisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};

Company.prototype.isLicenseWhitelisted = function (licKey) {
  const lc = this.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};

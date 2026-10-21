import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import { PackageURL } from 'packageurl-js';
import {ComponentSchema} from '/imports/lib/schemas/componentSchema';
import cotsComponents from '/imports/lib/collections/cotsComponents';
import Vulnerability from '/imports/lib/component/Vulnerability';
import SemverExt from '/imports/lib/component/SemverExt';
import Version from './Version';
import Utils from '/imports/lib/utils';

const LOG_CREATE = 'ComponentLogs.Create'

/**
 * Constructor
 * doc: the data object where all methods work on
 */
const COTSComponent = function COTSComponent(doc) {
  this.data = function () {
    return doc;
  };
  this._changed = false;
};

export default COTSComponent;

COTSComponent.prototype.changed = function changed() {
  this._changed = true;
};

COTSComponent.prototype.hasChanged = function hasChanged() {
  return this._changed;
};

COTSComponent.prototype.validate = function validate() {
  const context = ComponentSchema.newContext();
  context.validate(this.data());
  return context;
};

COTSComponent.prototype.getName = function getName() {
  return this.data().name;
};

COTSComponent.prototype.getKey = function getKey() {
  return this.data().key || 'unknown';
};

COTSComponent.prototype.isRemoved = function getName() {
  return this.data() && this.data().removed && this.data().removed === true;
};

COTSComponent.prototype.getPackageUrl = function getPackageUrl() {
  if(this.data().purl){
    return this.data() && this.data().purl
  }else{
    const result = new Utils.ComponentKey(this.data().key, {mgr: true, component: true});
    if(result && result.component && result.manager && result.manager !== 'im'){
      const parts = result.component.split(':');
      const org = parts.length > 1 ? parts[0]: null;
      const key = parts.length > 1 ? parts[1]: parts[0];
      let packageUrl = new PackageURL(result.manager, org, key)
      return packageUrl.toString();
    }else{
      return 'n.a.'
    }
  }
};

COTSComponent.prototype.setDescription = function setDescription(description, overwrite) {
  if ((overwrite === true || !this.data().description) && typeof description === 'string') {
    // remove whitespaces from description
    description = description.trim().replace(/\s+/g, ' ');
    if (this.data().description !== description) {
      this.data().description = description;
      this._changed = true;
    }
  }
};

COTSComponent.prototype.setShortDescription = function setShortDescription(shortDescription, overwrite) {
  if ((overwrite === true || !this.data().shortDescription) && typeof shortDescription === 'string') {
    // remove whitespaces from description
    shortDescription = shortDescription.trim().replace(/\s+/g, ' ');
    if (this.data().shortDescription !== shortDescription) {
      this.data().shortDescription = shortDescription;
      this._changed = true;
    }
  }
};

COTSComponent.prototype.getDescription = function getDescription() {
  return this.data().description;
};

COTSComponent.prototype.getShortDescription = function getShortDescription() {
  return this.data().shortDescription;
};

COTSComponent.prototype.getDeclaredCopyright = function getDeclaredCopyright() {
  return this.data().declaredCopyright;
};

COTSComponent.prototype.getEffectiveLicenses = function getEffectiveLicenses() {
  return this.data().effectiveLicenses;
};

COTSComponent.prototype.getConcludedLicenses = function getConcludedLicenses() {
  return this.data().concludedLicenses;
};

COTSComponent.prototype.getDeclaredLicenses = function getDeclaredLicenses() {
  return this.data().declaredLicenses;
};

COTSComponent.prototype.getComment = function getComment() {
  return this.data().comment;
};

COTSComponent.prototype.getRequirementsHW = function getDescription() {
  return this.data().requirements_hw;
};

COTSComponent.prototype.getRequirementsSW = function getDescription() {
  return this.data().requirements_sw;
};

COTSComponent.prototype.setRequirementsHW = function setDescription(requirements, overwrite) {
  if ((overwrite === true || !this.data().requirements) && typeof requirements === 'string') {
    // remove whitespaces from requirements
    requirements = requirements.trim().replace(/\s+/g, ' ');
    if (this.data().requirements_hw !== requirements) {
      this.data().requirements_hw = requirements;
      this._changed = true;
    }
  }
};

COTSComponent.prototype.setRequirementsSW = function setDescription(requirements, overwrite) {
  if ((overwrite === true || !this.data().requirements) && typeof requirements === 'string') {
    // remove whitespaces from requirements
    requirements = requirements.trim().replace(/\s+/g, ' ');
    if (this.data().requirements_sw !== requirements) {
      this.data().requirements_sw = requirements;
      this._changed = true;
    }
  }
};

COTSComponent.prototype.setComment = function setComment(comment, overwrite) {
  if ((overwrite === true || !this.data().comment) && typeof comment === 'string' && this.data().comment !== comment) {
    this.data().comment = comment;
    this._changed = true;
  }
};

COTSComponent.prototype.getLanguage = function getLanguage() {
  return this.data().language || 'unknown';
};

COTSComponent.prototype.setLanguage = function setLanguage(value, overwrite) {
  if (overwrite === true || !this.data().language) {
    if (value && this.data().language !== value) {
      this.data().language = value;
      this._changed = true;
    } else if (!value && this.data().language !== 'unknown') {
      this.data().language = 'unknown';
      this._changed = true;
    }
  }
};

COTSComponent.prototype.getUpdated = function getUpdated() {
  return this.data().updated || this.data().created;
};

COTSComponent.prototype.getUpdatedBy = function getUpdatedBy() {
  return this.data().updatedBy || this.data().createdBy;
};

COTSComponent.prototype.setUrl = function setUrl(type, url, overwrite) {
  if (type && (overwrite === true || !this.data().urls || !this.data().urls[type])) {
    if (!this.data().urls) {
      this.data().urls = {};
    }
    if (url) {
      this.data().urls[type] = url;
    } else {
      delete this.data().urls[type];
    }
    this._changed = true;
  }
};

COTSComponent.prototype.getUrl = function getUrl(type) {
  const urls = this.data().urls || {};
  return urls[type];
};

function getUserEmail(user) {
  return ((user.profile && user.profile.email)
    || (user.emails && user.emails[0] && user.emails[0].address) || 'ts-app');
}

COTSComponent.prototype.addLog = function addLog(user, version, text) {
  if (!user || !version || !this._id) {
    return;
  }
  Meteor.callAsync('ComponentLogs.Create', {
    createdBy: getUserEmail(user),
    componentKey: this.getKey(),
    componentId: this._id,
    version,
    text: text || version
  })
  this._changed = true;
};

COTSComponent.prototype.getLogs = function getLogs() {
  const logs = this.data().logs;
  return logs instanceof Array ? logs.slice().reverse() : [];
};

COTSComponent.prototype.store = function store(user, cb, companyUser) {
  const data = this.data();
  if (!data.created) {
    data.created = new Date();
    data.createdBy = user || 'unknown';
  }
  if (data._id) {
    data.updated = new Date();
    data.updatedBy = user || 'unknown';
    const modifier = {'$set': _.omit(data, ['_id'])}
    cotsComponents.update(data._id, modifier, cb);
    try {
      let changes = _.omit(modifier.$set, ['crawlerInfo','updatedBy'])
      const log = {
        createdBy: user || 'ts-app',
        companyId: companyUser && companyUser.profile && companyUser.profile.companyId,
        componentKey: data.key,
        componentId: data._id,
        text: 'update: ' + JSON.stringify(changes)
      };
      Meteor.callAsync(LOG_CREATE, log)
    }catch (e){
      console.log('COTSComponent.prototype.store error: ', e)
    }
  } else {
    data.key = data.key.toLowerCase();
    data._id = cotsComponents.insert(data, cb);
    Meteor.callAsync('logEvent', companyUser, 'New component created ' + data.key, 'componentCreated');
  }
  return true;
};

COTSComponent.prototype.setCrawlerInfo = function setCrawlerInfo(type, info, overwrite) {
  if (type && (overwrite === true || !this.data().crawlerInfo || !this.data().crawlerInfo[type])) {
    if (!this.data().crawlerInfo) {
      this.data().crawlerInfo = {};
    }
    if (info) {
      this.data().crawlerInfo[type] = info;
    } else {
      delete this.data().crawlerInfo[type];
    }
    this._changed = true;
  }
};

COTSComponent.prototype.getCrawlerInfo = function getCrawlerInfo(type) {
  const crawlerInfo = this.data().crawlerInfo || {};
  return crawlerInfo[type];
};

/**
 *  Relations management starts from here
 */
COTSComponent.prototype.findVersion = function findVersion(versionName) {
  if (this.data().versions) {
    const version = _.findWhere(this.data().versions, {version: versionName});
    if (version) {
      return new Version(version, this);
    }
  }
  return undefined;
};

COTSComponent.prototype.getVersion = function getVersion(versionName) {
  if (!this.data().versions) {
    this.data().versions = [];
  }
  let pkgVersion;
  try {
    let pkg = PackageURL.fromString(versionName)
    if(pkg && pkg.version){
      pkgVersion = pkg.version;
    }
    // eslint-disable-next-line no-empty, sonarjs/no-ignored-exceptions
  }catch (e){}
  let version = _.find(this.data().versions, function (version){
    return version.version === versionName || version.purl === versionName
      || (pkgVersion && version.version === pkgVersion)
  } );
  if (version === undefined) {
    if(versionName){
      if(pkgVersion){
        version = {version: pkgVersion, purl:versionName};
      }else{
        version = {version: versionName};
      }
      this.data().versions.push(version);
    }
    if (Meteor.isServer) {
      SemverExt.arraySortByVersion(this.data().versions);               // re-sort
    }
    this._changed = true;
  }
  return new Version(version, this);
};

if (Meteor.isServer) {
  COTSComponent.prototype.updateVersion = function updateVersion(version, releaseDate) {
    const v = this.getVersion(version);
    if (releaseDate && !v.getReleaseDate()) {
      v.setReleaseDate(releaseDate);
    }
  };
}

COTSComponent.prototype.countVersions = function getVersions() {
  let versions = this.data().versions || [];
  return versions.length;
};

COTSComponent.prototype.getVersions = function getVersions(descending) {
  let versions = this.data().versions || [];
  const resultVersions = [];
  versions = SemverExt.arraySortByVersion(versions);
  for (let i = 0; i < versions.length; i++) {
    if (!descending) {
      resultVersions.push(new Version(versions[i], this, i));
    } else {
      resultVersions.push(new Version(versions[versions.length - i - 1], this, i));
    }
  }
  return resultVersions;
};

COTSComponent.prototype.hasLicense = function hasLicense(licenseKey) {
  const versions = this.getVersions();
  if (licenseKey) {
    return _.find(versions, v => {
      return v.findLicense(licenseKey);
    });
  }
  return false;
};

COTSComponent.prototype.hasUnknownLicense = function () {
  const versions = this.getVersions();
  return _.find(versions, v => {
    const licenses = v.getLicenses();
    return licenses.length === 0 ||
      _.find(licenses, l => {
        return !l.getKey();
      });
  });
};

function strMax(s1, s2) {
  return s1 < s2 ? s2 : s1;
}

COTSComponent.prototype.getViability = function () {
  if (this.data().__viability === undefined) {
    const gitHub = this.data().crawlerInfo && this.data().crawlerInfo.github;
    let viability;
    if (gitHub && gitHub.status === 200 && gitHub.info) {
      viability = {
        lastVisit: gitHub.lastVisit,
        created_at: gitHub.info.created_at,
        changed_at: strMax(gitHub.info.updated_at, gitHub.info.pushed_at),
        openIssuesCnt: gitHub.info.open_issues_count,
        forksCnt: gitHub.info.forks_count,
        starsCnt: gitHub.info.stargazers_count,
        monthlyCommitCnt: gitHub.info.monthlyCommitCnt
      };
    } else {
      viability = {
        error: 'No information available'
      };
    }
    this.data().__viability = viability;
  }
  return this.data().__viability;
};

COTSComponent.prototype.getViabilityStatusFromLevel = function (level) {
  // level is in range 1..3
  const status = ['ok', 'warnings', 'violations'];
  if(level){
    return status[level - 1];
  }
  return status[2];
};

COTSComponent.prototype.getViabilityIndicators = function () {
  // viability = {
  //   lastVisit: gitHub.lastVisit,
  //   created_at: gitHub.info.created_at,
  //   changed_at: strMax(gitHub.info.updated_at, gitHub.info.pushed_at),
  //   openIssuesCnt: gitHub.info.open_issues_count,
  //   forksCnt: gitHub.info.forks_count,
  //   starsCnt: gitHub.info.stargazers_count,
  //   monthlyCommitCnt: gitHub.info.monthlyCommitCnt
  // };

  const viability = this.getViability();
  const result = {
    indicatorCount: 0,
    level: 0
  };

  if (!viability.error) {
    if (viability.starsCnt) {
      result.indicatorCount++;
      result.starsCnt = Utils.mapRange(viability.starsCnt, 1, 100, 1, 5);
      result.level += result.starsCnt;
    }
    if (viability.forksCnt) {
      result.indicatorCount++;
      result.forksCnt = Utils.mapRange(viability.forksCnt, 1, 100, 1, 5);
      result.level += result.forksCnt;
    }
    if (viability.monthlyCommitCnt && viability.monthlyCommitCnt.length > 11) {
      result.indicatorCount++;
      result.monthlyCommitCnt = Utils.mapRange(viability.monthlyCommitCnt[12], 0, 20, 1, 5);
      result.level += result.monthlyCommitCnt;
    }
    if (result.indicatorCount > 0) {
      result.level = Math.round(result.level / result.indicatorCount);
    }
  }
  //console.log('getViabilityIndicators(), component=', this.getName(), result);
  return result;
};

COTSComponent.prototype.getViabilityStatus = function (module) {
  if (!module || !module.viabilityConfig || !module.viabilityConfig.noInfoLevel) {
    return 'violations'; // the default status
  }
  const defaultLevel = this.getViabilityStatusFromLevel(module.viabilityConfig.noInfoLevel);
  const indicators = this.getViabilityIndicators();
  const warningsThres = module.viabilityConfig.warningThreshold || 0;
  const violationThres = module.viabilityConfig.violationThreshold || 0;

  if (!indicators || (indicators.indicatorCount < module.viabilityConfig.minConfidence)) {
    return defaultLevel;
  }

  if (violationThres && violationThres >= indicators.level) {
    return 'violations';
  }
  if (warningsThres && warningsThres >= indicators.level) {
    return 'warnings';
  }
  return 'ok';
};

COTSComponent.prototype.getMonthlyCommits = function () {
  const gitHub = this.data().crawlerInfo && this.data().crawlerInfo.github;
  if (gitHub && gitHub.status === 200 && gitHub.info) {
    return gitHub.info.monthlyCommitCnt;
  }
  return [];
};

COTSComponent.prototype.setField = function setField(field, data) {
  if (field) {
    if(data){
      this.data()[field] = data;
    }else {
      this.data()[field] = null;
    }
    this._changed = true;
  }
};

COTSComponent.prototype.getField = function getField(field) {
  const data = this.data() || {};
  return data[field];
};

COTSComponent.prototype.getCPE = function getCPE() {
  return this.data().cpe || [];
};

COTSComponent.prototype.getCategory = function getCategory() {
  return this.data().category || [];
};

COTSComponent.prototype.getAlgorithms = function getAlgorithms() {
  return this.data().crypto_algorithms || [];
};

COTSComponent.prototype.getAiModels = function getAiModels() {
  return this.data().ai_models || [];
};

COTSComponent.prototype.getCategoryString = function getCategoryString() {
  const list = this.data().category || [];
  return list.join(', ')
};

function convertVersionBridge(value) {
  if(value === 3){
    return 3
  }else if (value === 2){
    return 6
  }else if (value === 1){
    return 6
  }
}

if (Meteor.isServer) {

  COTSComponent.prototype.findAllVersions = function () {
    this.allVersions = this.getVersions().map(v => v.getVersion());
  };

  COTSComponent.prototype.getVersioningStatus = function (module, versions) {
    const allVersions = this.allVersions;
    const totalVersions = allVersions && allVersions.length;
    const indicator = allVersions && allVersions.indexOf(versions[versions.length - 1]);
    const difference = totalVersions - indicator;
    const warningsThres = module.versioningConfig.warningThreshold || 0;
    const violationThres = module.versioningConfig.violationThreshold || 0;

    if (violationThres && convertVersionBridge(violationThres) < difference) {
      return 'violations';

    }
    if (warningsThres && convertVersionBridge(warningsThres) < difference) {
      return 'warnings';
    }
    return 'ok';
  };

  // ASYNC, and server-only - this whole block is inside `if (Meteor.isServer)`.
  // It used to reach the synchronous `Vulnerability.findAll`, which cannot read a
  // Meteor 3 server cursor and answers [], so every version it was asked about came
  // back with no vulnerabilities.
  COTSComponent.prototype.findVulnerabilities = async function (companyId) {

    const versions = this.getVersions().map(v => v.getVersion());
    const vulns = await Vulnerability.findAllAsync(this.getKey(), versions, companyId);

    vulns.forEach(vuln => {
      const key = new Utils.ComponentKey(vuln.getEcsKey());
      const version = this.findVersion(key.version);
      if (version) {
        const versionData = version.data();
        if (!versionData.vulnerabilities) {
          versionData.vulnerabilities = [];
        }
        versionData.vulnerabilities.push(
          {
            name: vuln.getName(),
            link: vuln.getLink(),
            affectedVersion: version.getVersion(),
            description: vuln.getDescription(),
            status: vuln.getScoreLabel(),
            cvssColor: vuln.getCVSSColor(),
            vector: vuln.getVector(),
            score: !isNaN(vuln.getScore()) ? vuln.getScore().toFixed(1) : vuln.getScore(),
            severity: vuln.getSeverity(),
            confidence: vuln.getConfidence(),
            bump_hints: vuln.getBumpHints(),
            vendor: vuln.getConfidenceVendor(),
            product: vuln.getConfidenceProduct(),
            vuln: vuln.vuln
          }
        );
      }
    });
  };

  COTSComponent.prototype.getVulnerabilities = async function (versionList) {
    let vulnerabilities = [];
    const vulns = await Vulnerability.findAllAsync(this.getKey(), versionList);

    vulns.forEach(vuln => {
      vulnerabilities.push(
        {
          name: vuln.getName(),
          link: vuln.getLink(),
          description: vuln.getDescription(),
          status: vuln.getScoreLabel(),
          cvssColor: vuln.getCVSSColor(),
          vector: vuln.getVector(),
          score: !isNaN(vuln.getScore()) ? vuln.getScore().toFixed(1) : vuln.getScore(),
          severity: vuln.getSeverity()
        }
      );
    });
    return vulnerabilities
  };
}

import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import { PackageURL } from 'packageurl-js';
import {ComponentSchema} from '/imports/lib/schemas/componentSchema';
import Components from '/imports/lib/collections/components';
import Vulnerability from '/imports/lib/component/Vulnerability';
import SemverExt from '/imports/lib/component/SemverExt';
import Version from './Version';
import Utils from '/imports/lib/utils';
import {splitComponentKey} from '/imports/lib/component/keyFromPurl';

/**
 * Constructor
 * doc: the data object where all methods work on
 */
const Component = function Component(doc) {
  this.data = function () {
    return doc;
  };
  if(doc.root){
    this.root = true
  }
  this._changed = false;
  this.status = doc.status;
  this.statuses = doc.statuses;
};

export default Component;

const LOG_CREATE = 'ComponentLogs.Create'

Component.prototype.changed = function changed() {
  this._changed = true;
};

Component.prototype.hasChanged = function hasChanged() {
  return this._changed;
};

Component.prototype.validate = function validate() {
  const context = ComponentSchema.newContext();
  context.validate(this.data());
  return context;
};

Component.prototype.getName = function getName() {
  return this.data().name || this.data().key;
};

Component.prototype.getKey = function getKey() {
  return this.data().key || 'unknown';
};

Component.prototype.isRemoved = function getName() {
  return this.data() && this.data().removed && this.data().removed === true;
};

Component.prototype.getPackageUrl = function getPackageUrl() {
  if(this.data().purl){
    return this.data() && this.data().purl
  }else{
    const result = new Utils.ComponentKey(this.data().key, {mgr: true, component: true});
    if(result && result.component && result.manager && result.manager !== 'im'){
      const split = splitComponentKey(`${result.manager}:${result.component}`);
      const org = split ? split.namespace : null;
      const key = split ? split.name : result.component;
      try {
        let packageUrl = new PackageURL(result.manager, org, key)
        return packageUrl.toString();
      } catch (_e) { // eslint-disable-line sonarjs/no-ignored-exceptions -- fallback to manual purl construction
        return `pkg:${result.manager}/${org ? org + '/' : ''}${key}`;
      }
    }else{
      return 'n.a.'
    }
  }
};

Component.prototype.setDescription = function setDescription(description, overwrite) {
  if ((overwrite === true || !this.data().description) && typeof description === 'string') {
    description = description.trim().replace(/\s+/g, ' ');
    if (this.data().description !== description) {
      this.data().description = description;
      this._changed = true;
    }
  }
};

Component.prototype.setShortDescription = function setShortDescription(shortDescription, overwrite) {
  if ((overwrite === true || !this.data().shortDescription) && typeof shortDescription === 'string') {
    shortDescription = shortDescription.trim().replace(/\s+/g, ' ');
    if (this.data().shortDescription !== shortDescription) {
      this.data().shortDescription = shortDescription;
      this._changed = true;
    }
  }
};

Component.prototype.getDescription = function getDescription() {
  return this.data().description;
};

Component.prototype.getShortDescription = function getShortDescription() {
  return this.data().shortDescription;
};

Component.prototype.getDeclaredCopyright = function getDeclaredCopyright() {
  return this.data().declaredCopyright;
};

Component.prototype.getEffectiveLicenses = function getEffectiveLicenses() {
  return this.data().effectiveLicenses;
};

Component.prototype.getConcludedLicenses = function getConcludedLicenses() {
  return this.data().concludedLicenses;
};

Component.prototype.getDeclaredLicenses = function getDeclaredLicenses() {
  return this.data().declaredLicenses;
};

Component.prototype.getComment = function getComment() {
  return this.data().comment;
};

Component.prototype.setComment = function setComment(comment, overwrite) {
  if((overwrite === true || !this.data().comment) && typeof comment === 'string'
    && this.data().comment !== comment) {
    this.data().comment = comment;
    this._changed = true;
  }
};

Component.prototype.getLanguage = function getLanguage() {
  return this.data().language || 'unknown';
};

Component.prototype.setLanguage = function setLanguage(value, overwrite) {
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

Component.prototype.getUpdated = function getUpdated() {
  return this.data().updated || this.data().created;
};

Component.prototype.getUpdatedBy = function getUpdatedBy() {
  return this.data().updatedBy || this.data().createdBy;
};

Component.prototype.setUrl = function setUrl(type, url, overwrite) {
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

Component.prototype.getUrl = function getUrl(type) {
  const urls = this.data().urls || {};
  return urls[type];
};

function getUserEmail(user) {
  return ((user.profile && user.profile.email)
    || (user.emails && user.emails[0] && user.emails[0].address) || 'ts-app');
}

Component.prototype.addLog = function addLog(user, version, text) {
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

Component.prototype.getLogs = function getLogs() {
  const logs = this.data().logs;
  return logs instanceof Array ? logs.slice().reverse() : [];
};

function addChecksumAtomic(componentId, version, ck) {
  if (!ck || !ck.checksum) return;
  Components.updateAsync(
    {_id: componentId, 'versions.version': version},
    {$addToSet: {'versions.$.checksums': ck}}
  ).catch(function (e) { console.log('Component.store checksum $addToSet error:', e && e.message); });
}

function applyVersionAtomic(componentId, v) {
  if (!v || !v.version) return;
  const vNoCk = _.omit(v, 'checksums');
  const positionalSet = {};
  _.each(vNoCk, function (value, key) {
    positionalSet['versions.$.' + key] = value;
  });
  const setOp = Object.keys(positionalSet).length ? {$set: positionalSet} : null;
  const matchPromise = setOp
    ? Components.updateAsync({_id: componentId, 'versions.version': v.version}, setOp)
    : Promise.resolve(0);
  matchPromise.then(function (matched) {
    if (matched) return undefined;
    return Components.updateAsync(
      {_id: componentId, 'versions.version': {$ne: v.version}},
      {$push: {versions: vNoCk}}
    );
  }).then(function () {
    (v.checksums || []).forEach(function (ck) { addChecksumAtomic(componentId, v.version, ck); });
  }).catch(function (e) { console.log('Component.store version op error:', e && e.message); });
}

// store() is synchronous by contract - about twenty client-side edit pages call it and then
// carry on - so the four async calls it makes are deliberately not awaited. That made them
// UNHANDLED REJECTIONS, and an unhandled rejection ends the Node process. Observed on
// 2026-09-04 from ordinary sequential scan uploads: two runs raced on one brand-new key,
// the loser's insert came back E11000 duplicate key on key_1_unique, and the whole Meteor
// server exited. A losing race must degrade to a logged warning, not take the server down.
//
// ALL FOUR go through here, not just the two collection writes. The two audit calls looked
// safe and were not: the componentLogs one sits inside a try/catch, which cannot catch a
// rejection from a promise it never awaits, and the 'logEvent' one had no handler at all.
// QA drove the first of them to "Component ID must be of type String in componentLogs
// insertAsync" -> process exit, on the function this wrapper exists to make crash-proof.
//
// The original promise is returned unchanged, so callers see exactly what they saw before.
function catchStoreRejection(promise, operation, key) {
  if (promise && typeof promise.catch === 'function') {
    promise.catch(function (error) {
      // JSON.stringify, not raw interpolation: `key` comes from a scan payload and a
      // newline in it would otherwise forge a second log line.
      console.log('Component.store ' + operation + ' failed for', JSON.stringify(key), '-',
        JSON.stringify((error && error.message) || String(error)));
    });
  }
  return promise;
}

Component.prototype.store = function store(user, cb, companyUser) {
  const data = this.data();
  if (!data.created) {
    data.created = new Date();
    data.createdBy = user || 'unknown';
  }
  if (data._id) {
    data.updated = new Date();
    data.updatedBy = user || 'unknown';
    // On the SERVER, `versions` is excluded from the top-level $set so concurrent scans
    // of the same component don't wipe each other's version/checksum additions. Versions
    // are applied below via atomic per-version operators ($set positional + $addToSet of
    // checksums), keeping checksums additive under contention.
    //
    // On the CLIENT (e.g. critical-component edit pages), those atomic operators use
    // compound selectors like {_id, 'versions.version': v}, which Meteor rejects with
    // "Untrusted code may only updateAsync documents by ID. [403]". So on the client we
    // keep `versions` in the top-level $set - an update by plain _id, which is permitted.
    const omitFields = ['_id'];
    if (Meteor.isServer) {
      omitFields.push('versions');
    }
    const modifier = {'$set': _.omit(data, omitFields)};
    catchStoreRejection(Components.updateAsync(data._id, modifier, cb), 'update', data.key);

    // Apply versions atomically (server only - see comment above). For each in-memory row:
    //   1. If the row exists in DB, $set its non-checksum fields by positional match.
    //   2. Else $push a new row (without checksums).
    //   3. Then $addToSet every checksum so concurrent updates accumulate rather than overwrite.
    if (Meteor.isServer) {
      const versions = data.versions || [];
      versions.forEach(function (v) { applyVersionAtomic(data._id, v); });
    }
    try {
      let changes = _.omit(modifier.$set, ['crawlerInfo','updatedBy'])
      const log = {
        createdBy: user || 'ts-app',
        companyId: companyUser && companyUser.profile && companyUser.profile.companyId,
        componentKey: data.key,
        componentId: data._id,
        text: 'update: ' + JSON.stringify(changes)
      };
      catchStoreRejection(Meteor.callAsync(LOG_CREATE, log), 'component log', data.key);
    }catch (e){
      console.log('Component.prototype.store error: ', e)
    }
  } else {
    data.key = data.key.toLowerCase();
    data._id = catchStoreRejection(Components.insertAsync(data, cb), 'insert', data.key);
    catchStoreRejection(
      Meteor.callAsync('logEvent', companyUser, 'New component created '+data.key, 'componentCreated'),
      'create event', data.key);
  }
  return true;
};

Component.prototype.setCrawlerInfo = function setCrawlerInfo(type, info, overwrite) {
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

Component.prototype.getCrawlerInfo = function getCrawlerInfo(type) {
  const crawlerInfo = this.data().crawlerInfo || {};
  return crawlerInfo[type];
};

/**
 *  Relations management starts from here
 */
Component.prototype.findVersion = function findVersion(versionName) {
  if (this.data().versions) {
    const version = _.findWhere(this.data().versions, {version: versionName});
    if (version) {
      return new Version(version, this);
    }
  }
  return undefined;
};

Component.prototype.getVersion = function getVersion(versionName) {
  if (!this.data().versions) {
    this.data().versions = [];
  }
  let version = _.find(this.data().versions, function (version){
    return version.version === versionName
  } );
  if (version === undefined && versionName) {
    version = {version: versionName};
    this.data().versions.push(version);
    if (Meteor.isServer) {
      SemverExt.arraySortByVersion(this.data().versions);               // re-sort
    }
    this._changed = true;
  }
  return new Version(version, this);
};

if (Meteor.isServer) {
  Component.prototype.updateVersion = function updateVersion(version, releaseDate) {
    const v = this.getVersion(version);
    if (releaseDate && !v.getReleaseDate()) {
      v.setReleaseDate(releaseDate);
    }
  };
}

Component.prototype.countVersions = function getVersions() {
  let versions = this.data().versions || [];
  return versions.length;
};

Component.prototype.getVersions = function getVersions(descending) {
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

Component.prototype.hasLicense = function hasLicense(licenseKey) {
  const versions = this.getVersions();
  if (licenseKey) {
    return _.find(versions, v => {
      return v.findLicense(licenseKey);
    });
  }
  return false;
};

Component.prototype.hasUnknownLicense = function () {
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

Component.prototype.getViability = function () {
  if(this && this.data() && this.data().info && this.data().info.viability){
    this.data().__viability = this.data().info.viability
    return this.data().info.viability;
  }
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

Component.prototype.getViabilityStatusFromLevel = function (level) {
  // level is in range 1..3
  const status = ['ok', 'warnings', 'violations'];
  if(level){
    return status[level - 1];
  }
  return status[2];
};

Component.prototype.getViabilityIndicators = function () {
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

Component.prototype.getViabilityStatus = function (module) {
  if (!module || (module && !module.viabilityConfig) || (module && module.viabilityConfig && !module.viabilityConfig.noInfoLevel)) {
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

Component.prototype.getMonthlyCommits = function () {
  const gitHub = this.data().crawlerInfo && this.data().crawlerInfo.github;
  if (gitHub && gitHub.status === 200 && gitHub.info) {
    return gitHub.info.monthlyCommitCnt;
  }
  return [];
};

Component.prototype.setToBeResearched = function setToBeResearched(value) {
  let data = this.data();
  if (value && data.toBeResearched !== value) {
    this.data().toBeResearched = value;
    this._changed = true;
  }
};

Component.prototype.getVersioning = function getVersioning() {
  let problems = this.data().problems;
  if(problems && problems.versioning){
    let violations = _.filter(problems.versioning,function (problem) {
      return problem.status === 'violations'
    });
    let warnings = _.filter(problems.versioning,function (problem) {
      return problem.status === 'warnings'
    });
    if(violations.length){
      return violations[0]
    }else if(warnings.length){
      return warnings[0]
    }
  }
  return {
    status: 'ok'
  }
};

Component.prototype.getVersioningStatus = function getVersioningStatus() {
  let problems = this.data().problems;
  if(problems && problems.versioning){
    let violations = _.filter(problems.versioning,function (problem) {
      return problem.status === 'violations'
    });
    if(violations.length){
      return 'violations'
    }
    let warnings = _.filter(problems.versioning,function (problem) {
      return problem.status === 'warnings'
    });
    if(warnings.length){
      return 'warnings'
    }
  }
  return 'ok'
};

Component.prototype.getEncryption = function getEncryption() {
  let problems = this.data().problems;
  if(problems && problems.encryption){
    let violations = _.filter(problems.encryption,function (problem) {
      return problem.status === 'violations'
    });
    let warnings = _.filter(problems.encryption,function (problem) {
      return problem.status === 'warnings'
    });
    if(violations.length){
      return violations[0]
    }else if(warnings.length){
      return warnings[0]
    }
  }
  return {
    status: 'ok'
  }
};

Component.prototype.getEncryptionStatus = function getEncryptionStatus() {
  let problems = this.data().problems;
  if(problems && problems.encryption){
    let violations = _.filter(problems.encryption,function (problem) {
      return problem.status === 'violations'
    });
    if(violations.length){
      return 'violations'
    }
    let warnings = _.filter(problems.encryption,function (problem) {
      return problem.status === 'warnings'
    });
    if(warnings.length){
      return 'warnings'
    }
  }
  return 'ok'
};

Component.prototype.getEndoflife = function getEndoflife() {
  let problems = this.data().problems;
  if(problems && problems.endoflife){
    let violations = _.filter(problems.endoflife,function (problem) {
      return problem.status === 'violations'
    });
    let warnings = _.filter(problems.endoflife,function (problem) {
      return problem.status === 'warnings'
    });
    if(violations.length){
      return violations[0]
    }else if(warnings.length){
      return warnings[0]
    }
  }
  return {
    status: 'ok'
  }
};

Component.prototype.getCPE = function getCPE() {
  return this.data().cpe || [];
};

Component.prototype.setField = function setField(field, data) {
  if (field) {
    if(data){
      this.data()[field] = data;
    }else {
      this.data()[field] = null;
    }
    this._changed = true;
  }
};

Component.prototype.getField = function getField(field) {
  const data = this.data() || {};
  return data[field];
};

Component.prototype.getCategory = function getCategory() {
  return this.data().category || [];
};

Component.prototype.getAlgorithms = function getAlgorithms() {
  return this.data().crypto_algorithms || [];
};

Component.prototype.getAiModels = function getAiModels() {
  return this.data().ai_models || [];
};

Component.prototype.getCategoryString = function getCategoryString() {
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

  Component.prototype.findAllVersions = function () {
    this.allVersions = this.getVersions().map(v => v.getVersion());
  };

  Component.prototype.getVersioningStatus = function (module, versions) {
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
  Component.prototype.findVulnerabilities = async function (companyId, analisedVulns) {

    const versions = this.getVersions().map(v => v.getVersion());
    const vulns = await Vulnerability.findAllAsync(this.getKey(), versions, companyId, analisedVulns);

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
            environmental: vuln.getEnvironmental(),
            baseScore: vuln.getBaseScore(),
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

  Component.prototype.getVulnerabilities = async function (versionList) {
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

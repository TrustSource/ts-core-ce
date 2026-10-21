import _ from 'underscore';
import semver from 'semver';
import moment from 'moment';
import { Utils } from './Utils.js';
import { SemverExt } from './SemverExt.js';
import { Vulnerability } from './Vulnerability.js';


let Component = {};

Component.findVersion = function findVersion(component, versionName) {
  if (component && component.versions) {
    const version = _.findWhere(component.versions, {version: versionName});
    if (version) {
      return version;
    }
  }
  return undefined;
};

Component.getVersion = function getVersion(component, versionName) {
  if (!component.versions) {
    component.versions = [];
  }
  let version = _.findWhere(component.versions, {version: versionName});
  if (version === undefined) {
    version = {version: versionName};
    component.versions.push(version);
    component.versions = SemverExt.arraySortByVersion(component.versions);
    component._changed = true;
  }
  return version;
};

Component.getVersions = function getVersions(component, descending) {
  let versions = (component && component.versions) || [];
  const resultVersions = [];
  versions = SemverExt.arraySortByVersion(versions);
  for (let i = 0; i < versions.length; i++) {
    if (!descending) {
      resultVersions.push(versions[i]);
    } else {
      resultVersions.push(versions[versions.length - i - 1]);
    }
  }
  return resultVersions;
};

function strMax(s1, s2) {
  return s1 < s2 ? s2 : s1;
}

Component.getViability = function (component) {
  if (component && component.__viability === undefined) {
    const gitHub = component.crawlerInfo && component.crawlerInfo.github;
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
    component.__viability = viability;
  }
  return component && component.__viability || {
    error: 'No information available'
  };
};

Component.getViabilityStatusFromLevel = function (level) {
  // the level is in range 1..3
  const status = ['ok', 'warnings', 'violations'];
  if(level){
    return status[level - 1];
  }
  return status[2];
};

Component.getViabilityIndicators = function (component) {
  // viability = {
  //   lastVisit: gitHub.lastVisit,
  //   created_at: gitHub.info.created_at,
  //   changed_at: strMax(gitHub.info.updated_at, gitHub.info.pushed_at),
  //   openIssuesCnt: gitHub.info.open_issues_count,
  //   forksCnt: gitHub.info.forks_count,
  //   starsCnt: gitHub.info.stargazers_count,
  //   monthlyCommitCnt: gitHub.info.monthlyCommitCnt
  // };

  const viability = Component.getViability(component);
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
  return result;
};

Component.getViabilityStatus = function (component, viabilityConfig) {
  if (!viabilityConfig || (viabilityConfig && !viabilityConfig.noInfoLevel)) {
    return 'violations';
  }
  const defaultLevel = Component.getViabilityStatusFromLevel(viabilityConfig.noInfoLevel);
  const indicators = Component.getViabilityIndicators(component);
  const warningsThres = viabilityConfig.warningThreshold || 0;
  const violationThres = viabilityConfig.violationThreshold || 0;

  if (!indicators || (indicators.indicatorCount < viabilityConfig.minConfidence)) {
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

Component.getOssfStatus = function (component, ossfConfig) {
  if (!component || (!ossfConfig) || (ossfConfig && !ossfConfig.noInfoLevel)) {
    return 'violations';
  }
  const defaultLevel = Component.getViabilityStatusFromLevel(ossfConfig.noInfoLevel);
  const indicators = Component.getOSSF(component);
  const warningsThres = ossfConfig.warningThreshold || 0;
  const violationThres = ossfConfig.violationThreshold || 0;

  if((indicators && !indicators.score) || !indicators){
    return defaultLevel
  }
  if (violationThres && violationThres >= indicators.score) {
    return 'violations';
  }
  if (warningsThres && warningsThres >= indicators.score) {
    return 'warnings';
  }
  return 'ok';
};

Component.getOSSF = function (component) {
  if (component && component.__ossf === undefined) {
    const ossf = component.crawlerInfo && component.crawlerInfo.ossf;
    let score;
    if (ossf && ossf.status === 200 && ossf.info) {
      score = ossf.info;
    } else {
      score = {
        error: 'No information available'
      };
    }
    component.__ossf = score;
  }
  return component && component.__ossf;
};

Component.getVersioning = function getVersioning(component) {
  let problems = component.problems;
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

Component.findAllVersions = function (component) {
  return Component.getVersions(component).map(v => v.version);
};

Component.getEncryption = function getEncryption(component) {
  let problems = component.problems;
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

Component.getEndoflife = function getEndoflife(component) {
  let problems = component.problems;
  if(problems && problems.endoflife){
    let violations = _.filter(problems.endoflife,function (problem) {
      return problem.status === 'violations'
    });
    if(violations.length){
      return 'violations'
    }
    let warnings = _.filter(problems.endoflife,function (problem) {
      return problem.status === 'warnings'
    });
    if(warnings.length){
      return 'warnings'
    }
  }
  return 'ok'
};

Component.getVersioningStatus = function getVersioningStatus(component, module, versions, allVersions) {
  const totalVersions = allVersions && allVersions.length;
  const indicator = allVersions && allVersions.indexOf(versions[versions.length - 1]);
  const difference = totalVersions - indicator;
  const warningsThres = (module.versioningConfig && module.versioningConfig.warningThreshold) || 0;
  const violationThres = (module.versioningConfig && module.versioningConfig.violationThreshold) || 0;

  function convertVersionBridge(value) {
    if(value === 3){
      return 3
    }else if (value === 2){
      return 6
    }else if (value === 1){
      return 6
    }
  }

  if (violationThres && convertVersionBridge(violationThres) < difference) {
    return 'violations';

  }
  if (warningsThres && convertVersionBridge(warningsThres) < difference) {
    return 'warnings';
  }
  return 'ok';
};

function getAgeMonths(fromDate, toDate = new Date()) {
  return moment(fromDate).diff(moment(toDate), 'months', false);
}

Component.getEndoflifeStatus = function getEndoflifeStatus(component, config, version) {
  if(component && (component.crawlerInfo && ((component.crawlerInfo.endoflife && !component.crawlerInfo.endoflife.info)
      || !component.crawlerInfo.endoflife)) || !component.crawlerInfo){
    return 'ok';
  }
  if(component.crawlerInfo.endoflife.info){
    const warningsThres = (config && config.warningThreshold) || 0;
    const violationThres = (config && config.violationThreshold) || 0;
    if(!warningsThres && !violationThres){
      return { status: 'ok' }
    }
    const major = semver.major(version);
    const minor = semver.minor(version);
    const majorMinor = major && minor ? `${major}.${minor}` : ''
    let info = component.crawlerInfo.endoflife.info.find(v => Number(v.name) === major || String(v.name) === majorMinor)
    let {name, label, releaseDate, isEol, eolFrom, isEoas, eoasFrom, latest} = info || {};
    if(isEol || isEoas){
      const ageMonths = getAgeMonths(new Date(eolFrom || eoasFrom));
      if (violationThres > 0 && (ageMonths < 0 || ageMonths <= violationThres)) {
        return {
          status: 'violations',
          name,
          label,
          releaseDate,
          isEol,
          eolFrom,
          isEoas,
          eoasFrom,
          latest
        };
      }
      if (warningsThres > 0 && (ageMonths < 0 || ageMonths <= warningsThres)) {
        return {
          status: 'warnings',
          name,
          label,
          releaseDate,
          isEol,
          eolFrom,
          isEoas,
          eoasFrom,
          latest
        };
      }
      return {
        status: 'ok'
      };
    }
  }
};

Component.findVulnerabilities = function findVulnerabilities(db, component, companyId) {

  const versions = Component.getVersions(component).map(v => v.version);
  const vulns = Vulnerability.findAll(db, component.key, versions, companyId);

  _.each(vulns, vuln => {
    const key = new Utils.ComponentKey(vuln.ecs && vuln.ecs.value);
    const version = Component.findVersion(component, key.version);
    if (version) {
      const versionData = version;
      if (!versionData.vulnerabilities) {
        versionData.vulnerabilities = [];
      }
      versionData.vulnerabilities.push(
        {
          name: Vulnerability.getName(vuln),
          link: Vulnerability.getLink(vuln),
          affectedVersion: version.version,
          description: Vulnerability.getDescription(vuln),
          status: Vulnerability.getScoreLabel(vuln),
          cvssColor: Vulnerability.getCVSSColor(vuln),
          vector: Vulnerability.getVector(vuln),
          score: !isNaN(Vulnerability.getScore(vuln)) ? Vulnerability.getScore(vuln).toFixed(1) : vuln.getScore(),
          severity: Vulnerability.getSeverity(vuln)
        }
      );
    }
  });
};


export { Component };

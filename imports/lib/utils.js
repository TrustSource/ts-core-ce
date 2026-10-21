/* eslint-disable no-useless-escape */
/* global process:false */

import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import { PackageURL } from 'packageurl-js';
import _ from 'underscore';
import Component from '/imports/lib/component/Component';
import License from '/imports/lib/component/License';
import {ALLOWED_PACKAGE_TYPES} from '/imports/lib/component/packageTypes';
import {pathLocation} from '/imports/lib/analysis/pathLocation';
import Projects from '/imports/lib/collections/projects';
import Constraints from '/imports/lib/collections/constraints';
import Rules from '/imports/lib/collections/rules';
import Modules from './collections/modules';
import Module from './project/Module';
import {getRunStatusCode, getFindingsSummary} from '/imports/lib/sarif/runStatus';

const UNASSIGNED_MODULES = 'Unassigned Modules'
const WL_COMPANY = 'Allowed in company'
const BL_COMPANY = 'Denied in company'
const WL_PROJECT = 'Allowed in project'
const BL_PROJECT = 'Denied in project'
const WL_MODULE = 'Allowed in module'
const BL_MODULE = 'Denied in module'
const COMP_UNMOD = '!Component_modified'
const COMP_DISTR_OBJ = 'Component_dist_obj'

const Utils = {
  mongoPath: function mongoPath(path) {
    const args = Array.prototype.slice.call(arguments, 1);
    let count = 0;

    return path.replace(/\$/g, function (match) {
      const res = args[count++];
      return res !== undefined ? res : match;
    });
  },

  format: function (formatStr) {
    const args = Array.prototype.slice.call(arguments, 1);
    return formatStr.replace(/{(\d+)}/g, function (match, number) {
      return typeof args[number] !== 'undefined' ? args[number] : match;
    });
  },

  formatPercent: function (value, precision) {
    precision = precision || 1;
    try {
      return (value * 100).toFixed(precision) + '%';
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_error) {
      return value;
    }
  },

  pick: pick,

  mapRange: mapRange,

  userId: function (extUser, force) {
    let user = Meteor.isClient ? Meteor.user() : null;
    if(!user || force){
      user = extUser
    }
    if (user) {
      return user._id
    }
    return 'anonymous';
  },

  getUser: function (extUser) {
    let user = Meteor.isClient ? Meteor.user() : null;
    if(!user){
      user = extUser
    }
    return user;
  },

  username: function (extUser, force) {
    let user = Meteor.isClient ? Meteor.user() : null;
    if(!user || force){
      user = extUser
    }
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
      if  (user.profile.email){
        return user.profile.email
      }
    }
    return 'anonymous';
  },

  userEmail: function (extUser) {
    const user = extUser || (Meteor.isClient ? Meteor.user() : null);
    if (user) {
      if (user.emails && user.emails[0] && user.emails[0].address) {
        return user.emails[0].address;
      }
      if  (user.profile.email){
        return user.profile.email
      }
    }
    return 'anonymous';
  },

  /**
   * parses and splits component coordinates in its parts 'packageManager:component:version'
   *  e.g. for maven artifacts:
   *     manager:        mvn
   *     component:      groupId:artifactId
   *     version:        version
   *
   *  e.g. for npm artifacts:
   *     manager:        npm
   *     component:      componentName
   *     version:        version
   *
   *
   * @param key containing component identifiers
   * @param parts
   * @returns a object with properties: manager, component, version.
   */
  ComponentKey: function (key, parts) {
    if (!key || typeof key.split !== 'function') {
      // throw new Error('key must be a string');
    }else{
      parts = parts || {mgr: true, component: true, version: true};

      const partsCnt = (parts.mgr ? 1 : 0) + (parts.component ? 1 : 0) + (parts.version ? 1 : 0);
      const splitParts = key.split(':');
      // component may exists of more than one part
      if (parts.component && splitParts.length < partsCnt || !parts.component && splitParts.length !== partsCnt) {
        //throw new Error('invalid key format:' + key);
      }else {
        let compStartIdx = 0, compEndIdx = splitParts.length;
        if (parts.mgr) {
          this.manager = splitParts[0];
          compStartIdx++;
        }
        if (parts.version) {
          this.version = splitParts[splitParts.length - 1];
          compEndIdx--;
        }
        if (parts.component) {
          this.component = '';
          for (let i = compStartIdx; i < compEndIdx; i++) {
            if (this.component) {
              this.component += ':';
            }
            this.component += splitParts[i];
          }
        }
      }
    }
  },

  Rating: {
    PLUSPLUS: 5,
    PLUS: 4,
    NEUTRAL: 3,
    MINUS: 2,
    MINUSMINUS: 1,
    UNKNOWN: -1
  },

  ComponentRegExp: function (regexp) {
    if (typeof regexp === 'string') {
      // Escape RegExp metacharacters that legitimately appear in component
      // keys/versions (e.g. '+' in 'apk:alpine:libstdc++'), but keep '*' as our
      // glob wildcard and '$' which callers append as an end-anchor.
      regexp = regexp.replace(/[-\/\\^+?.()|[\]{}]/g, '\\$&');
      regexp = regexp.replace(/\*/g, '.*');   // replace all * with .*
      return new RegExp(regexp);
    }
    if (regexp instanceof RegExp) {
      return regexp;
    }
    throw new TypeError('Invalid type for RegExp');
  },

  isTestInstance: function () {
    const testData = JSON.parse(process.env.TEST_METADATA || {});
    return !!testData.isTest;
  }
};

Utils.ComponentRegExp.check = function (expr) {
  try {
    new Utils.ComponentRegExp(expr);
    return true;
  } catch (e) {
    console.log('Error:', expr, e);
  }
  return false;
};

Utils.escapeRegex = function (string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};


// ComponentRegExp.KEY is derived from getAllowedPackageTypes below
Utils.ComponentRegExp.VERSION = /^(?:[A-Za-z0-9_\.-]+|[A-Za-z0-9_\.-]*\*)$/;

/*
 * passwords must comprise at least 12 characters
 * passwords must contain at least 1 capital letter
 * passwords must contain at least one special character such as ( #!§$+*)(/%&=? )
 * passwords must contain at least one number (0123456789)
 * */
Utils.PaswordRegExp = /^((?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])(.{12,}))$/;

Utils.getAllowedLanguages = ['Assembly', 'C', 'C#', 'C/C++', 'Dart', 'Go', 'HTML', 'Java', 'Javascript', 'Kotlin', 'Nim',
  'Objective-C', 'Perl', 'PHP', 'Python', 'R', 'Ruby', 'Scala', 'Shell', 'SQL', 'Swift', 'Typescript']

Utils.getAllowedPackageTypes = ALLOWED_PACKAGE_TYPES

 
Utils.ComponentRegExp.KEY = new RegExp(
  '^(?:' + Utils.getAllowedPackageTypes.concat(['im', '\\*']).join('|') +
  '):(?:[A-Za-z0-9_\\.-]+?|[A-Za-z0-9_\\.-]*\\*)(?::(?:[A-Za-z0-9_\\.-]+\\*?|[A-Za-z0-9_\\.-]*\\*))?$'
);
 

Utils.languageToPackageType = function (lang) {
  const languageToPackageType = {
    'C': 'library',
    'C#': 'nuget',
    'C/C++': 'library',
    'Dart': 'pub',
    'Go': 'library',
    'HTML': 'bower',
    'Java': 'maven',
    'Javascript': 'npm',
    'Kotlin': 'maven',
    'Nim': 'nimble',
    'Objective-C': 'library',
    'Perl': 'ppm',
    'PHP': 'composer',
    'Python': 'pip',
    'R': 'library',
    'Ruby': 'bundler',
    'Scala': 'maven',
    'Shell': 'deb',
    'Swift': 'library',
    'Typescript': 'npm'
  };
  if (!Utils.getAllowedLanguages.includes(lang)) {
    return false;
  }
  return languageToPackageType[lang] || 'library';
}

/**
 *
 * @param rating
 * @returns {string} one of 'ok', 'warnings', 'violations' depending on rating input
 */
Utils.Rating.getState = function (rating) {
  if (_.isNumber(rating) === false) {
    throw Error('number required as rating');
  }
  const okOrWarnings = rating >= Utils.Rating.PLUS ? 'ok' : 'warnings';
  return rating <= Utils.Rating.MINUS ? 'violations' : okOrWarnings;
};


function isWhitelisted(license,company,project,module) {
  return company.isLicenseWhitelisted(license.key) || (typeof project.isLicenseWhitelisted === 'function' &&
    project.isLicenseWhitelisted(license.key)) || module.isLicenseWhitelisted(license.key)
}

function isBlacklisted(license,company,project,module) {
  return company.isLicenseBlacklisted(license.key) || (typeof project.isLicenseBlacklisted === 'function' &&
    project.isLicenseBlacklisted(license.key)) || module.isLicenseBlacklisted(license.key)
}
function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && module.isLicenseSelected &&
    module.isLicenseSelected(component, version, path, selectedLicense);
}

function isCveWhitelisted(cveKey, key, version, company, project, module) {
  // Prefer the entry that carries a `comment` so downstream consumers (e.g. CSAF generation)
  // can map the mute reason. company/project-level whitelist entries may have no comment;
  // module-level entries created via the mute UI always do.
  const companyHit = company.isCveWhitelisted(cveKey, key, version)
  const projectHit = (typeof project.isCveWhitelisted === 'function')
    && project.isCveWhitelisted(cveKey, key, version)
  const moduleHit = module.isCveWhitelisted(cveKey, key, version)
  return (companyHit && companyHit.comment && companyHit)
    || (projectHit && projectHit.comment && projectHit)
    || (moduleHit && moduleHit.comment && moduleHit)
    || companyHit || projectHit || moduleHit
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

// Exported for the vulnerability-alert evaluator, which has to
// apply exactly the threshold the release "New vulnerabilities" tab applies. The
// private function above stays the single implementation - there are already
// eight copies of this six-line map in the repo and a ninth would be one more
// thing to drift.
Utils.confidenceMap = confidenceMap;

Utils.getPackageUrl = function(componentKey, version) {
  const result = new Utils.ComponentKey(componentKey, { mgr: true, component: true });
  if (result && result.component && result.manager !== 'im') {
    const parts = result.component.split(':');
    const org = parts.length > 1 ? parts[0] : null;
    const key = parts.length > 1 ? parts[1] : parts[0];
    if (key) {
      const purl = new PackageURL(result.manager, org, key, version)
      return purl.toString()
    }
    return null;
  }
  return null;
}

Utils.ComponentKey = function(key, parts) {
  if (!key || typeof key.split !== 'function') {
    // throw new Error('key must be a string');
  } else {
    parts = parts || { mgr: true, component: true, version: true };

    const partsCnt = (parts.mgr ? 1 : 0) + (parts.component ? 1 : 0) + (parts.version ? 1 : 0);
    const splitParts = key.split(':');
    // component may exist of more than one part
    if ((parts.component && splitParts.length < partsCnt) || (!parts.component && splitParts.length !== partsCnt)) {
      // throw new Error('invalid key format:' + key);
    } else {
      let compStartIdx = 0; let
        compEndIdx = splitParts.length;
      if (parts.mgr) {
         
        this.manager = splitParts[0];
         
        compStartIdx++;
      }
      if (parts.version) {
        this.version = splitParts[splitParts.length - 1];
         
        compEndIdx--;
      }
      if (parts.component) {
        this.component = '';
         
        for (let i = compStartIdx; i < compEndIdx; i++) {
          if (this.component) {
            this.component += ':';
          }
          this.component += splitParts[i];
        }
      }
    }
  }
}

// Attached AFTER the ComponentKey definition above (a duplicate definition here
// previously discarded the prototype method defined earlier in the file).
Utils.ComponentKey.prototype.getKey = function () {
  return this.manager + ':' + this.component;
};

/**
 * Resolve the effective vulnerability confidence min-score with module -> project fallback.
 * A module that has no confidenceMinScore of its own inherits the one configured on its project.
 * @param {Object} module - module document (may define confidenceMinScore)
 * @param {Object} project - project document (may define confidenceMinScore)
 * @param {String|Number} [defaultVal] - fallback when neither module nor project define one
 * @returns {String|Number} the resolved min score
 */
Utils.resolveConfidenceMinScore = function (module, project, defaultVal) {
  return (module && module.confidenceMinScore) || (project && project.confidenceMinScore) || defaultVal;
};

/**
 * Update status of component based on allow/deny
 * @param {Object} module
 * @param {Object} project
 * @param {Object} company
 * @param {Object} component
 * @returns {object} with .label and .status
 */

Utils.updateComponentStatus = function (module, project, company, component, vulnConfidence) {
  let vulnerabilityConfidence = vulnConfidence || Utils.resolveConfidenceMinScore(module, project, 4)
  let viabilityStatus = 'ok';
  let settings = (module && module.analysis && module.analysis[0]) || module;
  if(settings && settings.viabilityConfig && settings.viabilityConfig.enabled) {
    viabilityStatus = component.getViabilityStatus(module);
  }
  let versioningStatus = 'ok';
  if(settings && settings.versioningConfig && settings.versioningConfig.enabled) {
    versioningStatus = component.getVersioningStatus();
  }
  let encryptionStatus = component.getEncryptionStatus();
  let vulnStatus = 'ok';
  let licenseStatus = 'ok';
  let multyLicenseStatus = 'ok'
  let total = 'ok';
  let label = 'OK';
  let listed = false;
  let notWhitelistedLicense = false;
  let multyLicense = false;
  let alterLabel;
  if (!project) {
    project = {name: UNASSIGNED_MODULES, _id: Projects.UNASSIGNED}
  }
  let requireWhitelist = company && company.requireWhitelist || project.requireWhitelist;

  component.getVersions().forEach(function (version) {
    if (version) {
      let list = version.getVulnerabilities();
      let vulnerabilities = _.map(_.filter(list, function (vuln) {
        return !isCveWhitelisted(vuln.name, component.getKey(), null, company, project, module)
          && confidenceMap(vuln.confidence) >= vulnerabilityConfidence
      }), function (vuln) {
        return vuln.status
      });
      vulnerabilities = _.unique(vulnerabilities);
      if(vulnerabilities.indexOf('violations') > -1){
        vulnStatus = 'violations'
      }else if (vulnerabilities.indexOf('warnings') > -1){
        vulnStatus = 'warnings'
      }
      let states = _.flatten(_.map(version.data().paths, function (licenseComponent) {
        return licenseComponent.licenses
      }));
      let uniqueLicenses = _.unique(states, function (licenseComponent) {
        return licenseComponent && licenseComponent.key
      });
      if(uniqueLicenses.length > 1){
        multyLicenseStatus = 'warnings'
        let newLicenses = [];
        let selectedLicense = _.find(uniqueLicenses,function (license) {
          return license && isLicenseSelected(module, component.getKey(), null, null, license.key)
        });
        if(!selectedLicense){
          multyLicense = true;
        }else{
          newLicenses.push(selectedLicense);
        }
        states = newLicenses
      }
      if(!states || states.length < 1) {
        licenseStatus = 'warnings';
        label = 'Warnings';
      } else if(multyLicense){
        licenseStatus = 'warnings';
        label = 'Warnings';
        multyLicenseStatus = 'violations'
      } else if (company && _.any(states, function (item) {
        if(item){
          return _.any(company.privateLicenses, function (privateLicenseItem) {
            return privateLicenseItem && privateLicenseItem.key === item.key
          });
        }else{
          return false
        }
      })) {
        licenseStatus = 'ok';
      } else if (_.any(states, function (item) {
        return (requireWhitelist && !isWhitelisted(item,company,project,module))
      })) {
        notWhitelistedLicense = true;
      } else if (_.any(states, function (item) {
        return ((item && item.status && (item.status.status === 'violations') ||
          (item && isBlacklisted(item,company,project,module))) && !isWhitelisted(item,company,project,module))
      })) {
        licenseStatus = 'violations';
        label = 'Violations';
      } else if (_.any(states, function (item) {
        return item && item.status && item.status.status === 'warnings' && !isWhitelisted(item,company,project,module)
        // eslint-disable-next-line sonarjs/no-duplicated-branches
      })) {
        licenseStatus = 'warnings';
        label = 'Warnings';
      }
      if (company && company.isComponentWhitelisted && company.isComponentWhitelisted(component.getKey(),
        version.getVersion())) {
        label = WL_COMPANY;
        total = 'ok';
        listed = true
      } else if (company && company.isComponentBlacklisted && company.isComponentBlacklisted(component.getKey(),
        version.getVersion())) {
        label = BL_COMPANY;
        total = 'violations';
        listed = true
      } else if (project && typeof project.isComponentWhitelisted === 'function' &&
        project.isComponentWhitelisted(component.getKey(), version.getVersion())) {
        label = WL_PROJECT;
        total = 'ok';
        listed = true
      } else if (project && typeof project.isComponentBlacklisted === 'function' &&
        project.isComponentBlacklisted(component.getKey(), version.getVersion())) {
        label = BL_PROJECT;
        total = 'violations';
        listed = true
      } else if (module.isComponentWhitelisted && module.isComponentWhitelisted(component.getKey(), version.getVersion())) {
        label = WL_MODULE;
        total = 'ok';
        listed = true
      } else if (module.isComponentBlacklisted && module.isComponentBlacklisted(component.getKey(), version.getVersion())) {
        label = BL_MODULE;
        total = 'violations';
        listed = true
      }else if (module.isComponentChangedStatus && module.isComponentChangedStatus(component.getKey(), version.getVersion())){
        let changedComponent = module.isComponentChangedStatus(component.getKey(), version.getVersion());
        if(changedComponent.status === 'whitelisted'){
          label = WL_MODULE;
          total = 'ok';
          listed = true
        }else if(changedComponent.status === 'blacklisted'){
          label = BL_MODULE;
          total = 'violations';
          listed = true
        }else if(changedComponent.status === 'ok'){
          label = 'Ok (Changed)';
          total = 'ok';
          listed = true
        }else if(changedComponent.status === 'warnings'){
          label = 'Warnings (Changed)';
          total = 'warnings';
          listed = true
        }else if(changedComponent.status === 'violations'){
          label = 'Violations (Changed)';
          total = 'violations';
          listed = true
        }
      }
    }
  });
  if (!listed) {
    [licenseStatus, vulnStatus, viabilityStatus, versioningStatus, encryptionStatus].forEach(function (status) {
      if ((total === 'ok' || total === 'warnings') && status === 'violations') {
        total = 'violations';
        label = 'Violations';
      } else if (total === 'ok' && status === 'warnings') {
        total = 'warnings';
        label = 'Warnings';
      }
      if(notWhitelistedLicense){
        total = 'violations';
        alterLabel = 'Not allowed license (but '+label+')'
      }
    });
  }
  component.status = total;
  component.statuses = {
    legal: licenseStatus,
    vulnerability: vulnStatus,
    viability: viabilityStatus,
    versioning: versioningStatus,
    encryption: encryptionStatus,
    'multy-legal': multyLicenseStatus
  };
  component.label = alterLabel || label;
  return component;
};

/**
 * Update status of license based on allow/deny
 * @param {Object} module
 * @param {Object} project
 * @param {Object} company
 * @param {Object} license
 * @returns {object} with .label and .status
 */
Utils.updateLicenseStatus = function (module, project, company, license) {
  let status;
  let label = 'Unknown';
  if (!project) {
    project = {name: UNASSIGNED_MODULES, _id: Projects.UNASSIGNED}
  }
  if (!company) {
    return false
  }
  let requireWhitelist = (company && company.requireWhitelist) || (project && project.requireWhitelist);

  if (company && company.isLicenseWhitelisted && company.isLicenseWhitelisted(license.getKey())) {
    status = 'ok';
    label = WL_COMPANY;
  } else if (company && company.isLicenseBlacklisted && company.isLicenseBlacklisted(license.getKey())) {
    status = 'violations';
    label = BL_COMPANY;
  } else if (project && typeof project.isLicenseWhitelisted === 'function' && project.isLicenseWhitelisted(license.getKey())) {
    status = 'ok';
    label = WL_PROJECT;
  } else if (project && typeof project.isLicenseBlacklisted === 'function' && project.isLicenseBlacklisted(license.getKey())) {
    status = 'violations';
    label = BL_PROJECT;
  } else if (module.isLicenseWhitelisted(license.getKey())) {
    status = 'ok';
    label = WL_MODULE;
  } else if (module.isLicenseBlacklisted(license.getKey())) {
    status = 'violations';
    label = BL_MODULE;
  } else {
    status = license.getStatus();
    if (status === 'ok') {
      label = 'OK';
    } else if (status === 'warnings') {
      label = 'Warnings';
    } else if (status === 'violations') {
      label = 'Violations';
    }
  }
  license.status = status;
  license.label = label;
  if(company){
    license.privateLicense =_.any(company.privateLicenses, function (privateLicenseItem) {
      return privateLicenseItem.key === license.getKey()
    });
    if(license.privateLicense){
      license.status = 'ok';
      license.label = 'Private license';
    }
  }
  if(requireWhitelist){
    license.requireWhitelist = company && typeof company.isLicenseWhitelisted === 'function' &&
      company.isLicenseWhitelisted(license.getKey())||
      project && typeof project.isLicenseWhitelisted === 'function' && project.isLicenseWhitelisted(license.getKey())||
      module.isLicenseWhitelisted(license.getKey());
  }
  return license;
};

/**
 * Update status of license based on allow/deny
 * @param {Object} module
 * @param {Object} project
 * @param {Object} company
 * @param {String} licenseKey
 * @param {String} licenseStatus
 * @returns {object} with .label and .status
 */
Utils.computedLicenseStatusDetails = function (module, project, company, licenseKey, licenseStatus) {

  let status;
  let label = 'Unknown';
  if (!project) {
    project = {name: UNASSIGNED_MODULES, _id: Projects.UNASSIGNED}
  }
  let requireWhitelist = company && company.requireWhitelist || project.requireWhitelist;

  if (company && company.isLicenseWhitelisted && company.isLicenseWhitelisted(licenseKey)) {
    status = 'ok';
    label = WL_COMPANY;
  } else if (company && company.isLicenseBlacklisted && company.isLicenseBlacklisted(licenseKey)) {
    status = 'violations';
    label = BL_COMPANY;
  } else if (project && typeof project.isLicenseWhitelisted === 'function' && project.isLicenseWhitelisted(licenseKey)) {
    status = 'ok';
    label = WL_PROJECT;
  } else if (project && typeof project.isLicenseBlacklisted === 'function' && project.isLicenseBlacklisted(licenseKey)) {
    status = 'violations';
    label = BL_PROJECT;
  } else if (module.isLicenseWhitelisted(licenseKey)) {
    status = 'ok';
    label = WL_MODULE;
  } else if (module.isLicenseBlacklisted(licenseKey)) {
    status = 'violations';
    label = BL_MODULE;
  } else {
    status = licenseStatus;
    if (licenseStatus.status){
      status = licenseStatus.status;
    }
    if (status === 'ok') {
      label = 'OK';
    } else if (status === 'warnings') {
      label = 'Warnings';
    } else if (status === 'violations') {
      label = 'Violations';
    }
  }
  let privateLicense = false;
  if(company){
    privateLicense =_.any(company.privateLicenses, function (privateLicenseItem) {
      return privateLicenseItem.key === licenseKey
    });
    if(privateLicense){
      status = 'ok';
      label = 'Private license';
    }
  }
  if(requireWhitelist){
    return {
      requireWhitelist : company && typeof company.isLicenseWhitelisted === 'function' &&
      company.isLicenseWhitelisted(licenseKey) ||
      project && typeof project.isLicenseWhitelisted === 'function' && project.isLicenseWhitelisted(licenseKey) ||
      module.isLicenseWhitelisted(licenseKey),
      status:status,
      label:label,
      privateLicense:privateLicense
    }
  }
  return {
    status:status,
    label:label,
    privateLicense:privateLicense
  };
};


function isValidStatus(filter, type, component){
  if(!type){
    return !filter[component.status]
  }
  return !filter[(component.statuses && component.statuses[type])]
}

/**
 * Define list of components based on @param:components
 * @param {Object} module
 * @param {Object} project
 * @param {Object} company
 * @param {Object} components
 * @param {Boolean} withoutFilter
 * @returns [array] of {Component}
 */
Utils.defineComponentsList = function (module, project, company, components, withoutFilter) {
  let componentList = [];
  if (components && components.length) {
    let filter = Session.get('moduleDetailFilter') || {};
    let filterType = Session.get('moduleDetailFilterType');
    let filterList = Session.get('moduleDetailListFilter') || '';
    _.forEach(components, c => {
      let component = new Component(c);
      if ((!component.status || isValidStatus(filter, filterType, component)) &&
        ((component.getKey() && component.getKey().toLowerCase().indexOf(filterList.toLowerCase()) > -1) ||
        (component.getName() && component.getName().toLowerCase().indexOf(filterList.toLowerCase()) > -1))) {
        if (filter.licenseName) {
          if (filter.licenseKey && component.hasLicense(filter.licenseKey) ||
            !filter.licenseKey && component.hasUnknownLicense()) {
            componentList.push(component);
          }
        } else {
          componentList.push(component);
        }
      } else if (withoutFilter){
        componentList.push(component);
      }
    });
  }
  return componentList
};

/**
 * Define list of licenses based on @param:module.getAnalysis()
 * @param {Object} module
 * @param {Object} project
 * @param {Object} company
 * @param {Boolean} withoutFilter
 * @param {String} analysisId
 * @returns [array] of {License}
 */
Utils.defineLicenseList = function (module, project, company, withoutFilter, analysisId) {
  let analysis = module.getAnalysis(null, analysisId);
  let licenses = analysis && (analysis.licenses || (typeof analysis.getLicenses == 'function' &&  analysis.getLicenses()));
  let licenseList = [];
  if (licenses) {
    if (!project) {
      project = {name: UNASSIGNED_MODULES, _id: Projects.UNASSIGNED}
    }
    if(withoutFilter){
      _.forEach(licenses, l => {
        let license = Utils.updateLicenseStatus(module, project, company, new License(l));
        licenseList.push(license);
      });
    }else{
      let filter = Session.get('moduleDetailFilter') || {};
      let filterList = Session.get('moduleDetailListFilter') || '';

      _.forEach(licenses, l => {
        let license = Utils.updateLicenseStatus(module, project, company, new License(l));
        let licKey = license.getKey();
        let licName = license.getName();
        if ((!license.getStatus() || !filter[license.getStatus()]) &&
          ((licKey && typeof licKey === 'string' && licKey.toLowerCase().indexOf(filterList.toLowerCase()) > -1) ||
          (licName && typeof licName === 'string' && licName.toLowerCase().indexOf(filterList.toLowerCase()) > -1))) {
          licenseList.push(license);
        }
      });
    }
  }
  return licenseList
};

/**
 * camelize string to get right cases
 * @param {String} str
 * @returns {String}
 */
Utils.camelize = function (str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function (letter, index) {
    return index === 0 ? letter.toLowerCase() : letter.toUpperCase();
  }).replace(/\s+/g, '');
};

/**
 * capitalize first letter of string
 * @param {String} string
 * @returns {String}
 */
Utils.capitalizeFirstLetter = function (string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

/**
 * Remove empty keys from object
 * @param {Object} obj
 * @returns {Object}
 */
Utils.removeEmpty = function (obj) {
  Object.keys(obj).forEach(function (key) {
    if (obj[key] && typeof obj[key] === 'object') {Utils.removeEmpty(obj[key])}
    else if (obj[key] === null || obj[key] === undefined || obj[key] === '') {delete obj[key]}
  });
  return obj;
};

/**
 * Remove empty keys from object extended version
 * @param {Object} obj
 * @returns {Object}
 */
Utils.cleanObject = function (obj) {
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      Utils.cleanObject(value);
      if (Object.keys(value).length === 0) delete obj[key];
    }
    else if (value === null || value === undefined || value === '') {
      delete obj[key];
    }
    else if (Array.isArray(value) && value.length === 0) {
      delete obj[key];
    }
  });
  return obj;
};

// Meteor 3: synchronous `.fetch()` is not allowed on the server. `translateObligations`
// and `translatePermitions` run both client- and server-side (REST check.js, report
// services), so cache the DB-backed definitions once at server startup and read the
// cache synchronously. The client keeps using the reactive sync fetch from minimongo.
let _serverConstraints = null;
let _serverRules = null;
// Also called after the legal definitions are seeded, so a fresh database never
// leaves the cache holding the empty collections it read first.
Utils.loadServerLegalDefinitions = async function () {
  try {
    _serverConstraints = await Constraints.find().fetchAsync();
  } catch (e) {
    console.error('Failed to load constraints for translateObligations:', e);
    _serverConstraints = [];
  }
  try {
    _serverRules = await Rules.find().fetchAsync();
  } catch (e) {
    console.error('Failed to load rules for translatePermitions:', e);
    _serverRules = [];
  }
};
if (Meteor.isServer) {
  Meteor.startup(Utils.loadServerLegalDefinitions);
}

/**
 * Return suggestion and description based on key
 * @param {String} key
 * @returns {Object}
 */
Utils.translateObligations = function (key) {
  let list;
  const constraintsList = Meteor.isServer ? (_serverConstraints || []) : Constraints.find().fetch();
  if(constraintsList.length > 0){
    list = constraintsList;
  }else{
    list = [
      {
        'key': 'O00',
        'name' : 'Retain Copyright Notice',
        'description' : 'You must retain the Copyright Notice (e.g. Copyright ©, Year, Copyright Holder).'
      },
      {
        'key': 'O01',
        'name': 'Provide a copy of the License Text',
        'description': 'You must provide a copy of the license text.',
        'setting': [
          [
            COMP_UNMOD
          ]
        ]
      },
      {
        'key': 'O02',
        'name': 'TechnicalRestriction',
        'description': 'You may not apply technological measures that restrict exercise of the granted rights.',
        'setting': [
          [
            COMP_UNMOD
          ]
        ]
      },
      {
        'key': 'O10',
        'name': 'Reproduce Copyright Notice',
        'description': 'You must reproduce the Copyright Notice.',
        'setting': [
          [
            COMP_UNMOD,
            'Component_dist_src'
          ],
          [
            'O20'
          ]
        ]
      },
      {
        'key': 'O11',
        'name': 'Reproduce Warranty Disclaimer',
        'description': 'You must reproduce the warranty disclaimer.',
        'setting': [
          [
            COMP_UNMOD,
            'Component_dist_src'
          ],
          [
            'O20'
          ]
        ]
      },
      {
        'key': 'O20',
        'name': 'Obligations Distribution in Source Form',
        'description': 'Obligations applying for the Distribution in Source Form must also be satisfied.',
        'setting': [
          [
            COMP_UNMOD,
            COMP_DISTR_OBJ
          ]
        ]
      },
      {
        'key': 'O21',
        'name': 'Reproduce Copyright Notice',
        'description': 'You must reproduce the Copyright Notice.',
        'setting': [
          [
            COMP_UNMOD,
            COMP_DISTR_OBJ
          ]
        ]
      },
      {
        'key': 'O22',
        'name': 'Reproduce Warranty Disclaimer',
        'description': 'You must reproduce the warranty disclaimer.',
        'setting': [
          [
            COMP_UNMOD,
            COMP_DISTR_OBJ
          ]
        ]
      },
      {
        'key': 'O23',
        'name': 'Provide Source Code',
        'description': 'You must provide the Source Code.',
        'setting': [
          [
            COMP_UNMOD,
            COMP_DISTR_OBJ
          ]
        ]
      },
      {
        'key': 'O40',
        'name': 'Copyleft Effect',
        'description': 'Modified software/derivative works must be licensed under the license.',
        'setting': [
          [
            'Component_modified'
          ]
        ]
      },
      {
        'key': 'O41',
        'name': 'Provide Source Code of the modified Software',
        'description': 'Source code of the modified software/derivative works must be ' +
        'made available to the recipients  of the software and/or - as the case may be - to other third parties. ',
        'setting': [
          [
            'Component_modified'
          ]
        ]
      },
      {
        'key': 'O42',
        'name': 'ShowChanges',
        'description': 'You must indicate changes made to the code.',
        'setting': [
          [
            'Component_modified'
          ]
        ]
      },
      {
        'key': 'O60',
        'name': 'SaaS Trigger',
        'description' : 'A usage of the Software in a ASP/SaaS scenario may - under certain conditions - ' +
        'trigger obligations such as making the source code available to the user.',
        'setting': [
          [
            'Component_as_service'
          ]
        ]
      }
    ];
  }
  return _.find(list,function (item) {
    return item.key === key
  })
};

/**
 * Return permission and violation based on key
 * @param {String} key
 * @returns {Object}
 */
Utils.translatePermitions = function (key) {
  let list;
  const rulesList = Meteor.isServer ? (_serverRules || []) : Rules.find().fetch();
  if(rulesList.length > 0){
    // A copy: pushing onto rulesList would grow the server cache on every call.
    list = rulesList.concat([{
      'key'      : 'Unknown',
      'type'    : 'warning',
      'message' : 'Component doesn\'t have license information'
    }]);
  }else{
    list = [
      {
        'key'      : 'CA_1',
        'setting' : ['CA_usage'],
        'require' : ['R8'],
        'type'    : 'violation',
        'message' : 'This license does not allow commercial use. HINT: Either drop component or provide as free solution.'
      },
      {
        'key'      : 'CA_2',
        'setting' : ['CA_license'],
        'require' : ['R8', 'R9'],
        'type'    : 'violation',
        'message' : 'This license does not allow commercialization under a license. HINT Drop the component or ' +
        'choose another compensation model'
      },
      {
        'key'      : 'CA_3',
        'setting' : ['CA_support'],
        'require' : ['R8'],
        'type'    : 'violation',
        'message' : 'This license does not allow charging support fees. HINT Either drop component or ' +
        'change commercial model'
      },
      {
        'key'      : 'CA_4',
        'setting' : ['CA_other'],
        'require' : ['R8'],
        'type'    : 'violation',
        'message' : 'This license does not allow the desired way of commercialization. HINT Either drop ' +
        'component or change commercial model.'
      },
      {
        'key'      : 'IP_1',
        'setting' : ['IP_protect_y'],
        'require' : ['R6'],
        'type'    : 'warning',
        'message' : 'Please note, this license does not eliminate the risk of patent claims by contributors.' +
        ' HINT Either accept/ignore or select alternative component with more suitable regulations'
      },
      {
        'key'      : 'IP_2',
        'setting' : ['IP_enforce_2'],
        'require' : ['!T02'],
        'type'    : 'warning',
        'message' : 'Please note, this license bears the risk of termination, if you will be enforcing your ' +
        'rights against third parties. HINT: Try to substitute the component or unbundle it'
      },
      {
        'key'      : 'IP_3',
        'setting' : ['IP_enforce_3'],
        'require' : ['!T02'],
        'type'    : 'violation',
        'message' : 'Please note, this license will terminate in case you are enforcing your rights against ' +
        'third parties. HINT: Either substitute component or try to unbundle it'
      },
      {
        'key'      : 'TS_1',
        'setting' : ['TS_y', '!OM_SaaS'],
        'require' : ['!O41'],
        'type'    : 'violation',
        'message' : 'This license requires you to make your changes public. This exposes a threat to your aim ' +
        'to protect your trade secrets'
      },
      {
        'key'      : 'TS_2',
        'setting' : ['TS_y', 'OM_SaaS'],
        'require' : ['!O60'],
        'type'    : 'warning',
        'message' : 'Please note, that this license might require you to publish changes you have made even with ' +
        'derivative works. HINT Probably you might want to watch for another component'
      },
      {
        'key'      : 'TS_3',
        'setting' : ['TS_y'],
        'require' : ['!O40'],
        'type'    : 'deadly obligation',
        'message' : 'This license requires you to open source your source code'
      },
      {
        'key'      : 'LS_1',
        'setting' : ['LS_pl'],
        'require' : ['R5', '!O40'],
        'type'    : 'violation',
        'message' : 'This license requires you to retain the original license. HINT: resolution is possible ' +
        'by dropping or unbinding (use as infrastructure module) the component and a proper definition of your terms and conditions'
      },
      {
        'key'      : 'LS_2',
        'setting' : ['LS_os'],
        'require' : [],
        'type'    : 'warning',
        'message' : 'Applicable license must be selected and verified that licensee has all required rights ' +
        'for release under selected license'
      },
      {
        'key'      : 'OM_1',
        'setting' : ['!OM_SaaS'],
        'require' : [],
        'type'    : 'warning',
        'message' : 'Depending on components modification status, obligations from O10-O15 or O20-O26 apply'
      },
      {
        'key'      : 'MOD_1',
        'setting' : ['Component_modified'],
        'require' : ['R1'],
        'type'    : 'violation',
        'scope'   : 'component',
        'message' : 'This license does not allow you to modify the components. HINT: Either undo your changes or drop the component'
      },
      {
        'key'      : 'DIST_1',
        'setting' : ['Component_dist_src'],
        'require' : ['!T02'],
        'scope'   : 'component',
        'type'    : 'warning',
        'message' : 'The grant of rights (use, modification, reproduction, etc.) under the license is condition ' +
        'upon compliance with the license obligations'
      },
      {
        'key'      : 'DIST_2',
        'setting' : [COMP_DISTR_OBJ],
        'require' : ['!T02'],
        'scope'   : 'component',
        'type'    : 'warning',
        'message' : 'The grant of rights (use, modification, reproduction, etc.) under the license is condition ' +
        'upon compliance with the license obligations'
      },
      {
        'key'      : 'Unknown',
        'type'    : 'warning',
        'message' : 'Component doesn\'t have license information'
      }
    ];
  }
  return _.find(list,function (item) {
    return item.key === key
  })
};

/**
 * Convert string into regular module identifier
 * @param {String} moduleName
 * @returns {String}
 */
Utils.generateModuleIdentifier = function (moduleName) {
  let list = moduleName.replace(/\.?([A-Z])/g, function (x, y) {
    return y.toLowerCase()
  }).split(' ');
  list = _.map(list, function (item) {
    return item.trim()
  });
  return list.join('_').toLowerCase();
};

/**
 * Generate list of licenses for selector
 * @returns [array] of {label,value}
 */
Utils.getLicensesLabels = function () {
  return [{'label':'BSD with attribution','value':'BSD-3-Clause-Attribution'},
    {'label':'VOSTROM Public License for Open Source','value':'VOSTROM'},
    {'label':'Abstyles License','value':'Abstyles'},
    {'label':'3dfx Glide License','value':'Glide'},
    {'label':'Academic Free License v1.2','value':'AFL-1.2'},
    {'label':'Academic Free License v1.1','value':'AFL-1.1'},
    {'label':'Academic Free License v2.0','value':'AFL-2.0'},
    {'label':'Academic Free License v2.1','value':'AFL-2.1'},
    {'label':'Academic Free License v3.0','value':'AFL-3.0'},
    {'label':'Academy of Motion Picture Arts and Sciences BSD','value':'AMPAS'},
    {'label':'Adobe Postscript AFM License','value':'APAFML'},
    {'label':'Adaptive Public License 1.0','value':'APL-1.0'},
    {'label':'Adobe Glyph List License','value':'Adobe-Glyph'},
    {'label':'Adobe Systems Incorporated Source Code License Agreement','value':'Adobe-2006'},
    {'label':'Afmparse License','value':'Afmparse'},
    {'label':'Amazon Digital Services License','value':'ADSL'},
    {'label':'Affero General Public License v1.0','value':'AGPL-1.0'},
    {'label':'Aladdin Free Public License','value':'Aladdin'},
    {'label':'AMD´s plpa_map.c License','value':'AMDPLPA'},
    {'label':'ANTLR Software Rights Notice','value':'ANTLR-PD'},
    {'label':'Apache License 1.0','value':'Apache-1.0'},
    {'label':'Apple Public Source License 1.1','value':'APSL-1.1'},
    {'label':'Attribution Assurance License','value':'AAL'},
    {'label':'Beerware License','value':'Beerware'},
    {'label':'BSD 2-clause FreeBSD License','value':'BSD-2-Clause-FreeBSD'},
    {'label':'BSD 4-clause \"Original\" or \"Old\" License','value':'BSD-4-Clause'},
    {'label':'Caldera License','value':'Caldera'},
    {'label':'Apple MIT License','value':'AML'},
    {'label':'Apple Public Source License 2.0','value':'APSL-2.0'},
    {'label':'Barr License','value':'Barr'},
    {'label':'Apache License 1.1','value':'Apache-1.1'},
    {'label':'Apple Public Source License 1.2','value':'APSL-1.2'},
    {'label':'Artistic License 1.0 w/clause 8','value':'Artistic-1.0-cl8'},
    {'label':'Apple Public Source License 1.0','value':'APSL-1.0'},
    {'label':'Artistic License 1.0 (Perl)','value':'Artistic-1.0-Perl'},
    {'label':'Apache License 2.0','value':'Apache-2.0'},
    {'label':'Artistic License 1.0','value':'Artistic-1.0'},
    {'label':'Bahyph License','value':'Bahyph'},
    {'label':'Boost Software License 1.0','value':'BSL-1.0'},
    {'label':'BSD 3-clause \"New\" or \"Revised\" License','value':'BSD-3-Clause'},
    {'label':'bzip2 and libbzip2 License v1.0.5','value':'bzip2-1.0.5'},
    {'label':'CMU License','value':'MIT-CMU'},
    {'label':'Common Development and Distribution License 1.0','value':'CDDL-1.0'},
    {'label':'Common Public License 1.0','value':'CPL-1.0'},
    {'label':'BitTorrent Open Source License v1.1','value':'BitTorrent-1.1'},
    {'label':'BSD 2-clause NetBSD License','value':'BSD-2-Clause-NetBSD'},
    {'label':'BSD-4-Clause (University of California-Specific)','value':'BSD-4-Clause-UC'},
    {'label':'BitTorrent Open Source License v1.0','value':'BitTorrent-1.0'},
    {'label':'Artistic License 2.0','value':'Artistic-2.0'},
    {'label':'BSD 2-clause \"Simplified\" License','value':'BSD-2-Clause'},
    {'label':'Borceux license','value':'Borceux'},
    {'label':'BSD Protection License','value':'BSD-Protection'},
    {'label':'BSD 3-clause Clear License','value':'BSD-3-Clause-Clear'},
    {'label':'bzip2 and libbzip2 License v1.0.6','value':'bzip2-1.0.6'},
    {'label':'CeCILL-B Free Software License Agreement','value':'CECILL-B'},
    {'label':'CeCILL Free Software License Agreement v1.1','value':'CECILL-1.1'},
    {'label':'Clarified Artistic License','value':'ClArtistic'},
    {'label':'Creative Commons Attribution 2.5','value':'CC-BY-2.5'},
    {'label':'Creative Commons Attribution Non Commercial 1.0','value':'CC-BY-NC-1.0'},
    {'label':'CeCILL Free Software License Agreement v2.0','value':'CECILL-2.0'},
    {'label':'CNRI Python Open Source GPL Compatible License Agreement','value':'CNRI-Python-GPL-Compatible'},
    {'label':'CeCILL Free Software License Agreement v1.0','value':'CECILL-1.0'},
    {'label':'Code Project Open License 1.02','value':'CPOL-1.02'},
    {'label':'Condor Public License v1.1','value':'Condor-1.1'},
    {'label':'Common Public Attribution License 1.0','value':'CPAL-1.0'},
    {'label':'Creative Commons Attribution 2.0','value':'CC-BY-2.0'},
    {'label':'Creative Commons Attribution Non Commercial 4.0','value':'CC-BY-NC-4.0'},
    {'label':'Creative Commons Attribution Non Commercial No Derivatives 3.0','value':'CC-BY-NC-ND-3.0'},
    {'label':'Computer Associates Trusted Open Source License 1.1','value':'CATOSL-1.1'},
    {'label':'Creative Commons Attribution 3.0','value':'CC-BY-3.0'},
    {'label':'CeCILL-C Free Software License Agreement','value':'CECILL-C'},
    {'label':'Common Development and Distribution License 1.1','value':'CDDL-1.1'},
    {'label':'Creative Commons Attribution 4.0','value':'CC-BY-4.0'},
    {'label':'Creative Commons Attribution No Derivatives 3.0','value':'CC-BY-ND-3.0'},
    {'label':'CNRI Python License','value':'CNRI-Python'},
    {'label':'Creative Commons Attribution No Derivatives 2.0','value':'CC-BY-ND-2.0'},
    {'label':'Creative Commons Attribution Non Commercial 2.5','value':'CC-BY-NC-2.5'},
    {'label':'Creative Commons Attribution Non Commercial Share Alike 3.0','value':'CC-BY-NC-SA-3.0'},
    {'label':'Creative Commons Zero v1.0 Universal','value':'CC0-1.0'},
    {'label':'Creative Commons Attribution No Derivatives 2.5','value':'CC-BY-ND-2.5'},
    {'label':'Creative Commons Attribution Non Commercial 3.0','value':'CC-BY-NC-3.0'},
    {'label':'Creative Commons Attribution 1.0','value':'CC-BY-1.0'},
    {'label':'Creative Commons Attribution No Derivatives 1.0','value':'CC-BY-ND-1.0'},
    {'label':'Creative Commons Attribution Non Commercial No Derivatives 2.5','value':'CC-BY-NC-ND-2.5'},
    {'label':'Creative Commons Attribution Non Commercial Share Alike 2.5','value':'CC-BY-NC-SA-2.5'},
    {'label':'Creative Commons Attribution Non Commercial No Derivatives 1.0','value':'CC-BY-NC-ND-1.0'},
    {'label':'Creative Commons Attribution Non Commercial Share Alike 1.0','value':'CC-BY-NC-SA-1.0'},
    {'label':'Creative Commons Attribution Share Alike 1.0','value':'CC-BY-SA-1.0'},
    {'label':'CUA Office Public License v1.0','value':'CUA-OPL-1.0'},
    {'label':'Dotseqn License','value':'Dotseqn'},
    {'label':'eGenix.com Public License 1.1.0','value':'eGenix'},
    {'label':'enna License','value':'MIT-enna'},
    {'label':'Creative Commons Attribution Non Commercial No Derivatives 2.0','value':'CC-BY-NC-ND-2.0'},
    {'label':'Creative Commons Attribution Non Commercial Share Alike 2.0','value':'CC-BY-NC-SA-2.0'},
    {'label':'Creative Commons Attribution No Derivatives 4.0','value':'CC-BY-ND-4.0'},
    {'label':'Creative Commons Attribution Non Commercial 2.0','value':'CC-BY-NC-2.0'},
    {'label':'Creative Commons Attribution Share Alike 2.5','value':'CC-BY-SA-2.5'},
    {'label':'Crossword License','value':'Crossword'},
    {'label':'Deutsche Freie Software Lizenz','value':'D-FSL-1.0'},
    {'label':'Educational Community License v1.0','value':'ECL-1.0'},
    {'label':'Enlightenment License (e16)','value':'MIT-advertising'},
    {'label':'Creative Commons Attribution Share Alike 4.0','value':'CC-BY-SA-4.0'},
    {'label':'DOC License','value':'DOC'},
    {'label':'DSDP License','value':'DSDP'},
    {'label':'Eiffel Forum License v1.0','value':'EFL-1.0'},
    {'label':'European Union Public License 1.1','value':'EUPL-1.1'},
    {'label':'Freetype Project License','value':'FTL'},
    {'label':'GL2PS License','value':'GL2PS'},
    {'label':'GNU Free Documentation License v1.3','value':'GFDL-1.3'},
    {'label':'Creative Commons Attribution Share Alike 2.0','value':'CC-BY-SA-2.0'},
    {'label':'Cube License','value':'Cube'},
    {'label':'diffmark license','value':'diffmark'},
    {'label':'Eclipse Public License 1.0','value':'EPL-1.0'},
    {'label':'Eiffel Forum License v2.0','value':'EFL-2.0'},
    {'label':'EU DataGrid Software License','value':'EUDatagrid'},
    {'label':'feh License','value':'MIT-feh'},
    {'label':'FSF Unlimited License (with License Retention)','value':'FSFULLR'},
    {'label':'Creative Commons Attribution Non Commercial No Derivatives 4.0','value':'CC-BY-NC-ND-4.0'},
    {'label':'Creative Commons Attribution Non Commercial Share Alike 4.0','value':'CC-BY-NC-SA-4.0'},
    {'label':'European Union Public License 1.0','value':'EUPL-1.0'},
    {'label':'Frameworx Open License 1.0','value':'Frameworx-1.0'},
    {'label':'Giftware License','value':'Giftware'},
    {'label':'Erlang Public License v1.1','value':'ErlPL-1.1'},
    {'label':'Eurosym License','value':'Eurosym'},
    {'label':'FreeImage Public License v1.0','value':'FreeImage'},
    {'label':'GNU Lesser General Public License v2.1 only','value':'LGPL-2.1'},
    {'label':'Historic Permission Notice and Disclaimer','value':'HPND'},
    {'label':'Imlib2 License','value':'Imlib2'},
    {'label':'ISC License','value':'ISC'},
    {'label':'GNU Free Documentation License v1.1','value':'GFDL-1.1'},
    {'label':'Creative Commons Attribution Share Alike 3.0','value':'CC-BY-SA-3.0'},
    {'label':'Do What The F*ck You Want To Public License','value':'WTFPL'},
    {'label':'dvipdfm License','value':'dvipdfm'},
    {'label':'Educational Community License v2.0','value':'ECL-2.0'},
    {'label':'Entessa Public License v1.0','value':'Entessa'},
    {'label':'Fair License','value':'Fair'},
    {'label':'FSF Unlimited License','value':'FSFUL'},
    {'label':'Glulxe License','value':'Glulxe'},
    {'label':'GNU Free Documentation License v1.2','value':'GFDL-1.2'},
    {'label':'GNU Lesser General Public License v3.0 only','value':'LGPL-3.0'},
    {'label':'gSOAP Public License v1.3b','value':'gSOAP-1.3b'},
    {'label':'GNU Affero General Public License v3.0','value':'AGPL-3.0'},
    {'label':'LaTeX Project Public License v1.1','value':'LPPL-1.1'},
    {'label':'Leptonica License','value':'Leptonica'},
    {'label':'Lucent Public License Version 1.0','value':'LPL-1.0'},
    {'label':'MIT License','value':'MIT'},
    {'label':'mpich2 License','value':'mpich2'},
    {'label':'Naumen Public License','value':'Naumen'},
    {'label':'GNU General Public License v3.0 only','value':'GPL-3.0'},
    {'label':'Haskell Language Report License','value':'HaskellReport'},
    {'label':'ImageMagick License','value':'ImageMagick'},
    {'label':'Intel Open Source License','value':'Intel'},
    {'label':'JSON License','value':'JSON'},
    {'label':'Latex2e License','value':'Latex2e'},
    {'label':'GNU General Public License v1.0 only','value':'GPL-1.0'},
    {'label':'gnuplot License','value':'gnuplot'},
    {'label':'IBM PowerPC Initialization and Boot Software','value':'IBM-pibs'},
    {'label':'Independent JPEG Group License','value':'IJG'},
    {'label':'JasPer License','value':'JasPer-2.0'},
    {'label':'LaTeX Project Public License v1.2','value':'LPPL-1.2'},
    {'label':'libtiff License','value':'libtiff'},
    {'label':'iMatix Standard Function Library Agreement','value':'iMatix'},
    {'label':'IPA Font License','value':'IPA'},
    {'label':'LaTeX Project Public License v1.0','value':'LPPL-1.0'},
    {'label':'GNU General Public License v2.0 only','value':'GPL-2.0'},
    {'label':'Lawrence Berkeley National Labs BSD variant license','value':'BSD-3-Clause-LBNL'},
    {'label':'MakeIndex License','value':'MakeIndex'},
    {'label':'MirOS Licence','value':'MirOS'},
    {'label':'Netizen Open Source License','value':'NOSL'},
    {'label':'Lucent Public License v1.02','value':'LPL-1.02'},
    {'label':'Microsoft Reciprocal License','value':'MS-RL'},
    {'label':'Mozilla Public License 1.0','value':'MPL-1.0'},
    {'label':'Matrix Template Library License','value':'MTLL'},
    {'label':'MIT +no-false-attribs license','value':'MITNFA'},
    {'label':'Mozilla Public License 1.1','value':'MPL-1.1'},
    {'label':'Mozilla Public License 2.0','value':'MPL-2.0'},
    {'label':'Mup License','value':'Mup'},
    {'label':'Nethack General Public License','value':'NGPL'},
    {'label':'No Limit Public License','value':'NLPL'},
    {'label':'NTP License','value':'NTP'},
    {'label':'Open Group Test Suite License','value':'OGTSL'},
    {'label':'Open LDAP Public License v1.2','value':'OLDAP-1.2'},
    {'label':'GNU Library General Public License v2 only','value':'LGPL-2.0'},
    {'label':'IBM Public License v1.0','value':'IPL-1.0'},
    {'label':'Intel ACPI Software License Agreement','value':'Intel-ACPI'},
    {'label':'Nokia Open Source License','value':'Nokia'},
    {'label':'Nunit License','value':'Nunit'},
    {'label':'Open LDAP Public License  2.2.2','value':'OLDAP-2.2.2'},
    {'label':'Open LDAP Public License v2.0 (or possibly 2.0A and 2.0B)','value':'OLDAP-2.0'},
    {'label':'Open LDAP Public License v2.3','value':'OLDAP-2.3'},
    {'label':'Open LDAP Public License v2.8','value':'OLDAP-2.8'},
    {'label':'Mozilla Public License 2.0 (no copyleft exception)','value':'MPL-2.0-no-copyleft-exception'},
    {'label':'NetCDF license','value':'NetCDF'},
    {'label':'NASA Open Source Agreement 1.3','value':'NASA-1.3'},
    {'label':'Netscape Public License v1.0','value':'NPL-1.0'},
    {'label':'Open LDAP Public License v2.2.1','value':'OLDAP-2.2.1'},
    {'label':'Open LDAP Public License v2.7','value':'OLDAP-2.7'},
    {'label':'Open Software License 2.0','value':'OSL-2.0'},
    {'label':'OpenSSL License','value':'OpenSSL'},
    {'label':'psutils License','value':'psutils'},
    {'label':'LaTeX Project Public License 1.3a','value':'LPPL-1.3a'},
    {'label':'LaTeX Project Public License v1.3c','value':'LPPL-1.3c'},
    {'label':'libpng License','value':'Libpng'},
    {'label':'Microsoft Public License','value':'MS-PL'},
    {'label':'Open Software License 1.1','value':'OSL-1.1'},
    {'label':'PHP License v3.0','value':'PHP-3.0'},
    {'label':'Python License 2.0','value':'Python-2.0'},
    {'label':'Netscape Public License v1.1','value':'NPL-1.1'},
    {'label':'NRL License','value':'NRL'},
    {'label':'ODC Public Domain Dedication & License 1.0','value':'PDDL-1.0'},
    {'label':'Noweb License','value':'Noweb'},
    {'label':'OCLC Research Public License 2.0','value':'OCLC-2.0'},
    {'label':'Open LDAP Public License v1.1','value':'OLDAP-1.1'},
    {'label':'Open LDAP Public License v2.0.1','value':'OLDAP-2.0.1'},
    {'label':'Open LDAP Public License v2.4','value':'OLDAP-2.4'},
    {'label':'Open Market License','value':'OML'},
    {'label':'RealNetworks Public Source License v1.0','value':'RPSL-1.0'},
    {'label':'Motosoto License','value':'Motosoto'},
    {'label':'Multics License','value':'Multics'},
    {'label':'Net Boolean Public License v1','value':'NBPL-1.0'},
    {'label':'Newsletr License','value':'Newsletr'},
    {'label':'Reciprocal Public License 1.1','value':'RPL-1.1'},
    {'label':'Saxpath License','value':'Saxpath'},
    {'label':'SGI Free Software License B v1.0','value':'SGI-B-1.0'},
    {'label':'Open LDAP Public License v1.4','value':'OLDAP-1.4'},
    {'label':'Open LDAP Public License v2.2','value':'OLDAP-2.2'},
    {'label':'Open LDAP Public License v2.6','value':'OLDAP-2.6'},
    {'label':'Open Public License v1.0','value':'OPL-1.0'},
    {'label':'Open Software License 2.1','value':'OSL-2.1'},
    {'label':'Plexus Classworlds License','value':'Plexus'},
    {'label':'Q Public License 1.0','value':'QPL-1.0'},
    {'label':'Ricoh Source Code Public License','value':'RSCPL'},
    {'label':'SGI Free Software License B v1.1','value':'SGI-B-1.1'},
    {'label':'Simple Public License 2.0','value':'SimPL-2.0'},
    {'label':'Non-Profit Open Software License 3.0','value':'NPOSL-3.0'},
    {'label':'SNIA Public License 1.1','value':'SNIA'},
    {'label':'PHP License v3.01','value':'PHP-3.01'},
    {'label':'psfrag License','value':'psfrag'},
    {'label':'Rdisc License','value':'Rdisc'},
    {'label':'Ruby License','value':'Ruby'},
    {'label':'SCEA Shared Source License','value':'SCEA'},
    {'label':'SIL Open Font License 1.1','value':'OFL-1.1'},
    {'label':'Reciprocal Public License 1.5','value':'RPL-1.5'},
    {'label':'Sax Public Domain Notice','value':'SAX-PD'},
    {'label':'SGI Free Software License B v2.0','value':'SGI-B-2.0'},
    {'label':'Sleepycat License','value':'Sleepycat'},
    {'label':'Sun Industry Standards Source License v1.1','value':'SISSL'},
    {'label':'Sun Public License v1.0','value':'SPL-1.0'},
    {'label':'ODC Open Database License v1.0','value':'ODbL-1.0'},
    {'label':'Open LDAP Public License v1.3','value':'OLDAP-1.3'},
    {'label':'Open LDAP Public License v2.1','value':'OLDAP-2.1'},
    {'label':'Open LDAP Public License v2.5','value':'OLDAP-2.5'},
    {'label':'Open Software License 1.0','value':'OSL-1.0'},
    {'label':'Open Software License 3.0','value':'OSL-3.0'},
    {'label':'Sun Industry Standards Source License v1.2','value':'SISSL-1.2'},
    {'label':'TMate Open Source License','value':'TMate'},
    {'label':'Vovida Software License v1.0','value':'VSL-1.0'},
    {'label':'X.Net License','value':'Xnet'},
    {'label':'XPP License','value':'xpp'},
    {'label':'Zend License v2.0','value':'Zend-2.0'},
    {'label':'zlib/libpng License with Acknowledgement','value':'zlib-acknowledgement'},
    {'label':'SugarCRM Public License v1.1.3','value':'SugarCRM-1.1.3'},
    {'label':'TCL/TK License','value':'TCL'},
    {'label':'Unicode Terms of Use','value':'Unicode-TOU'},
    {'label':'W3C Software Notice and License (1998-07-20)','value':'W3C-19980720'},
    {'label':'XFree86 License 1.1','value':'XFree86-1.1'},
    {'label':'Zed License','value':'Zed'},
    {'label':'Zimbra Public License v1.4','value':'Zimbra-1.4'},
    {'label':'Sybase Open Watcom Public License 1.0','value':'Watcom-1.0'},
    {'label':'TORQUE v2.5+ Software License v1.1','value':'TORQUE-1.1'},
    {'label':'Vim License','value':'Vim'},
    {'label':'X11 License','value':'X11'},
    {'label':'XSkat License','value':'XSkat'},
    {'label':'zlib License','value':'Zlib'},
    {'label':'Zope Public License 2.0','value':'ZPL-2.0'},
    {'label':'University of Illinois/NCSA Open Source License','value':'NCSA'},
    {'label':'Wsuipa License','value':'Wsuipa'},
    {'label':'xinetd License','value':'xinetd'},
    {'label':'Yahoo! Public License v1.1','value':'YPL-1.1'},
    {'label':'Zope Public License 1.1','value':'ZPL-1.1'},
    {'label':'ICU License','value':'ICU'},
    {'label':'PostgreSQL License','value':'PostgreSQL'},
    {'label':'Qhull License','value':'Qhull'},
    {'label':'Red Hat eCos Public License v1.1','value':'RHeCos-1.1'},
    {'label':'Scheme Widget Library (SWL) Software License Agreement','value':'SWL'},
    {'label':'SIL Open Font License 1.0','value':'OFL-1.0'},
    {'label':'Standard ML of New Jersey License','value':'SMLNJ'},
    {'label':'The Unlicense','value':'Unlicense'},
    {'label':'Trusster Open Source License','value':'TOSL'},
    {'label':'W3C Software Notice and License (2002-12-31)','value':'W3C'},
    {'label':'Xerox License','value':'Xerox'},
    {'label':'Yahoo! Public License v1.0','value':'YPL-1.0'},
    {'label':'Zimbra Public License v1.3','value':'Zimbra-1.3'},
    {'label':'Zope Public License 2.1','value':'ZPL-2.1'},
    {'label':'CNRI Jython License','value':'CNRI-Jython'},
    {'label':'RSA Message-Digest License ','value':'RSA-MD'},
    {'label':'Commercial License','value':'COMMERCIAL'},
    {'label':'No-License','value':'NO-LICENSE'},
    {'label':'JAVA ADVANCED IMAGING DISTRIBUTION LICENSE (VER. 1.1.X)','value':'JAI-JDL'},
    {'label':'Indiana University Extreme! Lab Software License Version 1.1.1','value':'Indiana-1.1.1'}
  ]
};

/**
 * check if a component object (determined by key and version(s) is contained in a array
 * @param arr the array to search within
 * @param key  the key eg. mvn:abc:xyz
 * @param version the version, if undefined only key is matched, if single value, single value is matched if array
 * the fourth parameter (all) decides if all (whitelist) or only one version (blacklist) of the component should match
 * @param all  if true, all versions (if version parameter is Array) must match, false: at least one version should match
 * @returns {boolean}
 */
 
Utils.findCompInArray = function (arr, key, version, all, path, selectedLicense) {
  if (!arr || !key) return false;

  if (version instanceof Array) {
    return _.find(arr, function (entry) {
      const keyRegExp = new Utils.ComponentRegExp(entry.key+'$');
      const verRegExp = new Utils.ComponentRegExp(entry.version+'$');
      let selectedLicenseRegExp;
      if (entry.license && selectedLicense) {
        selectedLicenseRegExp = new Utils.ComponentRegExp(entry.license)
      }
      let matched = false;
      if (key.match(keyRegExp)) {
        for (let i = 0; i < version.length; i++) {
          const m = version[i].match(verRegExp);
          if (!all && m) {
            if (entry.path && path) {
              if (entry.path === path) {
                if (entry.license && selectedLicense) {
                  if (selectedLicense.match(selectedLicenseRegExp)) {
                    matched = true;
                    break;
                  } else {
                    matched = false;
                    break;
                  }
                }
                matched = true;
                break;
              } else {
                matched = false;
                break;
              }
            }
            matched = true;
            break;
          } else if (all && !m) {
            matched = false;
            break;
          }
          matched = m;
        }
      }
      return matched;
    });
  } else {
    return _.find(arr, function (entry) {
      const keyRegExp = new Utils.ComponentRegExp(entry.key+'$');
      const verRegExp = new Utils.ComponentRegExp(entry.version+'$');
      let matchedPath = true;
      let matchedSelectedLicense = true;
      if (entry.path && path) {
        matchedPath = entry.path === path;
      }
      if (entry.license && selectedLicense) {
        matchedSelectedLicense = selectedLicense.match(new Utils.ComponentRegExp(entry.license));
      }
      return key && key.match(keyRegExp) && (!entry.version || version === '*' || (version && version.match(verRegExp))) &&
        matchedPath && matchedSelectedLicense;
    });
  }
};


function isUnchanged(module, component, version, path) {
  return module && module.isComponentUnchanged && module.isComponentUnchanged(component.key, version, pathLocation(path));
}

function isLooseCoupled(module, component, version, path) {
  return module && module.isComponentLooseCoupled && module.isComponentLooseCoupled(component.key, version, pathLocation(path));
}

/**
 * define input data for ecs-check service
 * @param module
 * @param moduleComponents the array of components
 * @param project
 * @returns {object}
 */
 
function extractLicenseKeys(allLicenses) {
  return _.map(allLicenses, function (license) {
    let lic = license.key || license.name
    return (lic && (typeof lic === 'string' || lic instanceof String)) ? lic : false
  }).filter((item) => item);
}

function buildComponentEntry(module, component, version, path) {
  const fallbackLicenses = component.declaredLicenses && component.declaredLicenses.length > 0 ? component.declaredLicenses : [];
  const allLicenses = version.licenses && version.licenses.length > 0 ? version.licenses : fallbackLicenses
  const hasParam = (name) => path.params && path.params.indexOf(name) > -1;
  let modified;
  if (hasParam('isUnchanged')) {
    modified = false;
  } else if (hasParam('isChanged')) {
    modified = true;
  } else {
    modified = !isUnchanged(module, component, '*', null);
  }
  return {
    'licenses': extractLicenseKeys(allLicenses),
    'modified': modified,
    'tightCoupled': hasParam('isLooseCoupled') ? true : !isLooseCoupled(module, component, '*', null)
  }
}

Utils.rebuildModuleObject = function (module, moduleComponents, project) {
  let components = {};
  _.each(moduleComponents, function (component) {
    _.each(component.versions, function (version) {
      _.each(version.paths, function (path, index) {
        components[component.key + ':' + version.version + ':' + index] =
          buildComponentEntry(module, component, version, path);
      });
    });
  });
  let settings;
  if(project && project.requirements){
    settings = _.extend(project.requirements, module.requirements);
  }else{
    settings = module.requirements
  }
  return {
    'key': module.name,
    'components': components,
    'CA_usage': settings && settings.CA === 'CA_usage',
    'CA_license': settings && settings.CA === 'CA_license',
    'CA_support': settings && settings.CA === 'CA_support',
    'CA_other': settings && settings.CA === 'CA_other',
    'CA_none': settings && settings.CA === 'CA_none',
    'OM_SaaS': settings && settings.OM === 'OM_SaaS',
    'OM_mop': settings && settings.OM === 'OM_mop',
    'OM_sw': settings && settings.OM === 'OM_sw',
    'OM_dis': settings && settings.OM === 'OM_dis',
    'IP_protect_n': settings && settings.IP_protect === 'IP_protect_n',
    'IP_protect_y': settings && settings.IP_protect === 'IP_protect_y',
    'IP_enforce_1': settings && settings.IP_enforce === 'IP_enforce_1',
    'IP_enforce_2': settings && settings.IP_enforce === 'IP_enforce_2',
    'IP_enforce_3': settings && settings.IP_enforce === 'IP_enforce_3',
    'TS_y': settings && settings.TS === 'TS_y',
    'TS_n': settings && settings.TS === 'TS_n',
    'LS_pl': settings && settings.LS === 'LS_pl',
    'LS_os': settings && settings.LS === 'LS_os',
    'D_op': settings && settings.D === 'D_op',
    'D_ipoa': settings && settings.D === 'D_ipoa',
    'D_xa': settings && settings.D === 'D_xa',
    'D_cslib': settings && settings.D === 'D_cslib',
    'D_sslib': settings && settings.D === 'D_sslib',
    'D_never': settings && settings.D === 'D_never'
  };
};

/**
 * check is user allow this notification
 * @param actionKey
 * @returns Boolean
 */
/*
 *- Event notifications
 * EVENTS_ALL
 ** All events
 * EVENTS_NEW
 ** New module analysis processed
 * EVENTS_CHANGES
 ** Analysis result changed
 * EVENTS_APPROVES
 ** Module new releases, approves or rejections
 * EVENTS_BY_EMAIL
 ** Send all events also by email
 *- Alarms notifications
 * ALARMS_ALL
 ** All alarms
 * ALARMS_COMPLIANCE
 ** Compliance issues in my project
 * ALARMS_VULNERABILITY
 ** New vulnerabilities in my project
 * ALARMS_ISSUES
 ** TrustSource operational issues
 * ALARMS_BY_EMAIL
 ** Send all alarms also by email
 *- General communications
 * NEWS_GENERAL
 ** TrustSource newsletter
 * NEWS_PROMO
 ** TrustSource events and promotional information
 * NEWS_EACG
 ** EACG events and promotional information
 */
Utils.isUserNotificationAllowed = function(user, actionKey) {
  const notifications = user.profile.notifications;
  if (Array.isArray(actionKey)){
    return notifications && _.any(actionKey, function (element) {
      return _.contains(notifications, element)
    });
  }else{
    return notifications && _.contains(notifications, actionKey);
  }
};

/**
 * define input data for ecs-check service
 * @param pathLicense
 * @returns {object}
 */
 
Utils.normalizeLicenseStatus = function(pathLicense, componentKey, obligationConfig, legalRulesConfig, notViolatedRulesKeys) {
  let resolved = [];
  if (pathLicense){
    if(obligationConfig && pathLicense.obligations){
      pathLicense.obligations = pathLicense.obligations.filter(function (obligation){
        return obligationConfig.filter(function (obligationConfigEntry){
          if(obligationConfigEntry.obligationKey === obligation && (obligationConfigEntry.key ?
            obligationConfigEntry.key === componentKey : true) && resolved.indexOf(obligation) === -1){
            resolved.push(obligation)
          }
          return obligationConfigEntry.obligationKey === obligation && (obligationConfigEntry.key ?
            obligationConfigEntry.key === componentKey : true)
        }).length === 0
      })
    }
    let resolvedViolations = [];
    if(legalRulesConfig && pathLicense.rules){
      pathLicense.rules = pathLicense.rules.filter(function (ruleKey){
        return legalRulesConfig.filter(function (legalRulesConfigEntry){
          if(legalRulesConfigEntry.ruleKey === ruleKey && (legalRulesConfigEntry.key ?
            legalRulesConfigEntry.key === componentKey : true) && resolvedViolations.indexOf(ruleKey) === -1){
            resolvedViolations.push(ruleKey)
          }
          return legalRulesConfigEntry.ruleKey === ruleKey && (legalRulesConfigEntry.key ?
            legalRulesConfigEntry.key === componentKey : true)
        }).length === 0
      })
    }
    if (pathLicense.status === 'SAT' || (
      (!pathLicense.obligations || pathLicense.obligations && pathLicense.obligations.length === 0) &&
      (!pathLicense.rules || pathLicense.rules && pathLicense.rules.length === 0))) {
      const violations = pathLicense.rules !== undefined && pathLicense.rules.join('; ')
      const obligations = pathLicense.obligations !== undefined && pathLicense.obligations.join('; ')
      return {
        status: (violations && violations.length) || (obligations && obligations.length) ? 'warnings' : 'ok',
        violations,
        obligations,
        resolvedObligations: resolved.join('; '),
        resolvedViolations: resolvedViolations.join('; ')
      }
    } else if (pathLicense.status === 'UNSAT') {
      const allWarnings = _.every(pathLicense.rules, function(rule) {
        return notViolatedRulesKeys.indexOf(rule) > -1
      })
      const violations = pathLicense.rules !== undefined && pathLicense.rules.join('; ')
      const obligations = pathLicense.obligations !== undefined && pathLicense.obligations.join('; ')
      return {
        status: allWarnings ? 'warnings' : 'violations',
        violations,
        obligations,
        resolvedObligations: resolved.join('; '),
        resolvedViolations: resolvedViolations.join('; ')
      }
    } else {
      return {
        status: 'warnings',
        reason: pathLicense.reason
      }
    }
  }
  return {
    status: 'warnings',
    reason: 'Please contact support. Certain aspects of this license are currently under investigation'
  }
};

Utils.serialize = function(obj, prefix) {
  let str = [], p;
  for (p in obj) {
    // eslint-disable-next-line no-prototype-builtins
    if (obj.hasOwnProperty(p)) {
      let k = prefix ? prefix + '[' + p + ']' : p,
        v = obj[p];
      str.push((v !== null && typeof v === 'object') ?
        Utils.serialize(v, k) :
        encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  }
  return str.join('&');
}

Utils.clean = function(obj) {
  for (let propName in obj) {
    if (obj[propName] === null || obj[propName] === undefined) {
      delete obj[propName];
    }
  }
  return obj
}

// De-duplicate the flat component list a dependency walk produces. A component can be
// reached from many tree nodes, but two nodes that differ in VERSION are two distinct
// BOM entries: keying on the component alone silently dropped every version but one
// (e.g. a project on guava 16.0 and 33.0.0-jre listed a single row), which hides a
// vulnerable version from the SBOM.
Utils.cleanComponents = function(dependency) {
  return _.sortBy(_.unique(dependency,(i) => {
    const id = (i && i.key) || (i && i.name);
    if(id){
      return i.version ? id + '@' + i.version : id
    }
    return id
  }),  (i) => {
    if(i && i.name){
      return i.name.toLowerCase()
    }else if (i && i.key){
      return i.key.toLowerCase()
    }
  })
}

Utils.groupedImpactVersions = function(impact) {
  if(impact){
    const supportedVersions = ['cvss2','cvss3','cvss4','cvss5']
    let obj= {};
    Object.keys(impact).forEach((key) => {
      const matchedVersion = supportedVersions.find(supportedVersion => {
        return key.indexOf(supportedVersion) === 0
      });
      if(matchedVersion){
        let target = matchedVersion
        if(key.indexOf('_') > -1){
          let sufix = key.split('_')
          target += `_${sufix[1]}`
        }
        obj[target] = _.clone(impact[key])
      }
    })
    return obj
  }
  return impact
}


Utils.cleanAndFixIdentifier = function(name) {
  return name.replace(/[^a-zA-Z0-9-_/]/g, '')
}


// Kept as a Utils member for the existing call sites; the logic lives in the
// meteor-free module so Jest can cover it and so the REST API and the Blaze cells
// read the same document the same way.
Utils.getRunStatusCode = getRunStatusCode

Utils.getSarifFindingsSummary = getFindingsSummary

Utils.isJsonString = function(str) {
  try {
    if(typeof str !== 'string') {
      JSON.parse(str.toString())
    }else{
      JSON.parse(str)
    }
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    return false;
  }
  return true;
}


// Last-resort lookup by display name inside one project.
//
// The ingest paths derive `moduleIdentifier` differently for the same component -
// `npm:admin-panel` from a ts-scan upload, `admin-panel` from an SBOM import,
// `AdminPanel` from a SARIF upload - so an identifier-only match makes whichever
// upload lands second miss the module the first one created and build a duplicate
// beside it. Matching the name catches exactly that case and makes arrival order
// stop mattering.
//
// Applied only after the identifier/_id match above has failed, and only when it is
// unambiguous. A polyglot repository may legitimately carry `npm:admin-panel` and
// `maven:admin-panel` under one display name; picking one of those at random would
// silently merge two different modules. Ambiguity is therefore reported and left
// alone, which falls back to the previous behaviour (create a new module).
async function findModuleByNameInProject(companyId, name, projectId) {
  const matches = await Modules.find({companyId, projectId, name}, {limit: 2}).fetchAsync();
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    console.error('=> findOrCreateModuleByCompanyIdAndName: module name', name,
      'is ambiguous in project', projectId,
      '- refusing to match by name, pass moduleId or moduleIdentifier to disambiguate');
  }
  return null;
}

// `touchScanned` (default true) stamps the module as freshly scanned when an existing one
// is matched. A SARIF upload passes false: it carries no dependency scan, and stamping it
// would make the module list report the analysis as outdated (scanned > analyzed).
Utils.findOrCreateModuleByCompanyIdAndName = async function findOrCreateModuleByCompanyIdAndName(
  companyId, name, moduleIdentifier, projectId, user, demo, touchScanned = true) {
  let filter = {
    $and:[
      {companyId},
      {$or:[{'moduleIdentifier': moduleIdentifier || name},{'_id': name}]}
    ]
  };
  if(projectId){
    filter.$and[0].projectId = projectId;
  }
  const modules = await Modules.find(filter).fetchAsync();
  const moduleByID = modules && _.find(modules, (item)=>{
    return item._id === name
  })
  const moduleByOther = modules && _.filter(modules, (item)=>{
    return item._id !== name
  })
  if(!moduleByID && moduleByOther.length > 1){
    console.warn('Warning: more than one module found by name or _id for', name, '- using first match');
  }
  let module = moduleByID ? moduleByID : moduleByOther && moduleByOther[0]
  if(!module && projectId && name){
    module = await findModuleByNameInProject(companyId, name, projectId);
  }
  let project = await Projects.findOneAsync(projectId);
  if (module) {
    if (touchScanned) {
      await Modules.updateAsync(module._id, { $set: { scanned: new Date() } });
    }
    console.log('=> processScan, Module found by name or _id: ', name);
    return module;
  } else {
    module = new Module(companyId, name, moduleIdentifier, projectId, demo);
    if(project && project.relatedUsers){
      module.relatedUsers = project.relatedUsers;
      delete module.relatedUsers.members;
      delete module.relatedUsers.pinnedBy;
    }
    module.scanned = new Date();
    console.log('Module not found, creating it...');
    module._id = await Modules.insertAsync(module);
    //TODO move call to some other place "Exception in defer callback: Error: Meteor.userId can only be invoked in method"
    Meteor.callAsync('logEvent', user, 'New module '+module.name+' created', 'moduleCreated');
    return module;
  }
}

Utils.extendQualityStats = function(stats, tools) {
  let data = stats;
  if(tools && Object.keys(tools).length > 0){
    Object.keys(tools).forEach(function (key) {
      let info = tools[key];
      const unAllowedKeys = ['scanId'];
      if(unAllowedKeys.indexOf(key) === -1){
        Object.keys(info).forEach(function (subKey) {
          const allowedKeys = ['ok', 'warnings', 'violations'];
          if(info[subKey] && allowedKeys.indexOf(subKey) > -1){
            data[subKey] += info[subKey];
            data.total += info[subKey];
          }
        })
      }
    })
  }
  data.okPercent = data.total ? (data.ok * 100) / data.total : 0;
  data.warningsPercent = data.total ? (data.warnings * 100) / data.total : 0;
  data.violationsPercent = data.total ? (data.violations * 100) / data.total : 0;
  return data
}


// the meteor buildin version of underscore (1.5.2) provides a pick method without predicate support
// so use this implementation instead
function pick(object, iteratee) {
  const result = {};
  let obj = object;
  let keys;

  if (obj === null) return result;

  if (typeof iteratee === 'function') {
    keys = Object.keys(object);
  } else {
    keys = [].slice.call(arguments, 1);
    iteratee = function (value, key, obj) {
      return key in obj;
    };
    obj = Object(obj);
  }
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    const value = obj[key];
    if (iteratee(value, key, obj)) result[key] = value;
  }
  return result;
}

function mapRange(x, in_min, in_max, out_min, out_max) {
  x = Math.max(x, in_min); // adjust to input range
  x = Math.min(x, in_max);
  return Math.round((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min);
}

export default Utils;

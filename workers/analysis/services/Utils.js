import _ from 'underscore';
import { Module } from './Module.js';
import CvssCalculator from 'ae-cvss-calculator';

let Utils = {
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
      let anchor = '';
      if (regexp.endsWith('$')) {
        anchor = '$';
        regexp = regexp.slice(0, -1);
      }
      regexp = regexp.replace(/[.+?^${}()|[\]\\]/g, '\\$&');  // escape all regex-special chars except *
      regexp = regexp.replace(/\*/g, '.*');   // replace all * with .*
      return new RegExp(regexp + anchor);
    }
    if (regexp instanceof RegExp) {
      return regexp;
    }
    throw new TypeError('Invalid type for RegExp');
  },
};

Utils.pick = function pick(object, iteratee) {
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
};

Utils.mapRange = function mapRange(x, in_min, in_max, out_min, out_max) {
  x = Math.max(x, in_min); // adjust to input range
  x = Math.min(x, in_max);
  return Math.round((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min);
};

Utils.Rating.getState = function (rating) {
  if (_.isNumber(rating) === false) {
    throw Error('number required as rating');
  }
  if(rating <= Utils.Rating.MINUS){
    return 'violation';
  }
  return rating >= Utils.Rating.PLUS ? 'ok' : 'warnings';
};

Utils.ComponentKey = function (key, parts) {
  if (!key || typeof key.split !== 'function') {
    // throw new Error('key must be a string');
  }else{
    parts = parts || {mgr: true, component: true, version: true};

    const partsCnt = (parts.mgr ? 1 : 0) + (parts.component ? 1 : 0) + (parts.version ? 1 : 0);
    const splitParts = key.split(':');
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
};

Utils.dbFind = async function (db, collection, filter, limit, sort, projection) {
  return await db.collection(collection).find(filter || {}, projection || {}).limit(limit || 1).sort(sort || {}).toArray()
};

Utils.dbFindOne = async function (db, collection, filter, projection) {
  return await db.collection(collection).findOne(filter || {}, projection || {})
};


function isUnchanged(module, component, version, path) {
  return Module.isComponentUnchanged(module, component.key, version, path);
}

function isLooseCoupled(module, component, version, path) {
  return Module.isComponentLooseCoupled(module, component.key, version, path);
}

 
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
              if (path === entry.path) {
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
        matchedPath = path === entry.path;
      }
      if (entry.license && selectedLicense) {
        matchedSelectedLicense = selectedLicense.match(new Utils.ComponentRegExp(entry.license));
      }
      return key && key.match(keyRegExp) && (!entry.version || version === '*' || (version && version.match(verRegExp))) &&
        matchedPath && matchedSelectedLicense;
    });
  }
};

 
Utils.rebuildModuleObject = function (module, moduleComponents, project) {
  let components = {};
  _.each(moduleComponents, function (component) {
     
    _.each(component.versions, function (version) {
      _.each(version.paths, function (path, index) {
        let allLicenses;
        if(version.licenses && version.licenses.length > 0){
          allLicenses = version.licenses
        }else{
          allLicenses = component.declaredLicenses && component.declaredLicenses.length > 0 ? component.declaredLicenses : []
        }
        components[component.key + ':' + version.version + ':' + index] = {
          // eslint-disable-next-line sonarjs/no-nested-functions
          'licenses': _.map(allLicenses, function (license) {
            let lic = license.key || license.name
            return (lic && (typeof lic === 'string' || lic instanceof String)) ? lic : false
          // eslint-disable-next-line sonarjs/no-nested-functions
          }).filter((item) => item),
          'modified': (path.params && path.params.indexOf('isUnchanged') > -1)? false :
            !isUnchanged(module, component, '*', null),
          'tightCoupled': (path.params && path.params.indexOf('isLooseCoupled') > -1)? true :
            !isLooseCoupled(module, component, '*', null)
        }
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


// The legal check costs one z3 solve per (component entry, license), and rebuildModuleObject
// emits one entry per component:version:path - a component reached from 800 places is asked
// 800 times. The answer depends only on the licenses and the two coupling flags, so only the
// DISTINCT combinations are sent and the answer is spread back over the full key space
// afterwards. On a 617-component module that is 4688 solves down to a few hundred.
function checkSignature(entry) {
  const licenses = (entry && entry.licenses) ? entry.licenses.slice().sort() : [];
  return JSON.stringify([licenses, !!(entry && entry.modified), !!(entry && entry.tightCoupled)]);
}

/**
 * @param {Object} components rebuildModuleObject's `components` map
 * @returns {{components: Object, groups: Object}} the entries to send, and for each sent key
 *          every original key it answers for (the sent key included)
 */
Utils.dedupeCheckComponents = function (components) {
  const representatives = {};
  const deduped = {};
  const groups = {};
  Object.keys(components || {}).forEach(function (key) {
    const signature = checkSignature(components[key]);
    if (!Object.prototype.hasOwnProperty.call(representatives, signature)) {
      representatives[signature] = key;
      deduped[key] = components[key];
      groups[key] = [];
    }
    groups[representatives[signature]].push(key);
  });
  return {components: deduped, groups: groups};
};

/**
 * Spread the check's answers back over every key each sent entry stood for.
 *
 * Each key gets its OWN copy: normalizeLicenseStatus rewrites obligations/rules on the
 * object it is handed and what it strips depends on the component key, so a shared
 * reference would let one component's resolution rewrite another's answer.
 *
 * @param {Object} answers the check's per-key answers
 * @param {Object} groups from dedupeCheckComponents
 * @returns {Object} answers keyed by every original component:version:path
 */
Utils.expandCheckResult = function (answers, groups) {
  const expanded = {};
  Object.keys(groups || {}).forEach(function (sentKey) {
    // `answers ? ... : undefined` so a missing map and a missing key both read as
    // "unanswered" rather than one of them turning into null.
    const answer = answers ? answers[sentKey] : undefined;
    groups[sentKey].forEach(function (key) {
      expanded[key] = (answer === undefined || answer === null) ? answer : JSON.parse(JSON.stringify(answer));
    });
  });
  return expanded;
};

 
Utils.normalizeLicenseStatus = function(pathLicense, componentKey, obligationConfig, legalRulesConfig, notViolatedRulesKeys) {
  let resolved = [];
  if (pathLicense){
    if(obligationConfig && pathLicense.obligations){
      pathLicense.obligations = pathLicense.obligations.filter(function (obligation){
        return obligationConfig.filter(function (obligationConfigEntry){
          if(obligationConfigEntry.obligationKey === obligation && (obligationConfigEntry.key ? obligationConfigEntry.key === componentKey : true) && resolved.indexOf(obligation) === -1){
            resolved.push(obligation)
          }
          return obligationConfigEntry.obligationKey === obligation && (obligationConfigEntry.key ? obligationConfigEntry.key === componentKey : true)
        }).length === 0
      })
    }
    let resolvedViolations = [];
    if(legalRulesConfig && pathLicense.rules){
      pathLicense.rules = pathLicense.rules.filter(function (ruleKey){
        return legalRulesConfig.filter(function (legalRulesConfigEntry){
          if(legalRulesConfigEntry.ruleKey === ruleKey && (legalRulesConfigEntry.key ? legalRulesConfigEntry.key === componentKey : true) && resolvedViolations.indexOf(ruleKey) === -1){
            resolvedViolations.push(ruleKey)
          }
          return legalRulesConfigEntry.ruleKey === ruleKey && (legalRulesConfigEntry.key ? legalRulesConfigEntry.key === componentKey : true)
        }).length === 0
      })
    }
    if (pathLicense.status === 'UNKNOWN') {
      return {
        status: 'warnings',
        reason: 'License could not be matched correctly'
      }
    }else if (pathLicense.status === 'SAT' || (
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

// The finding's own vector (from its `cves` entry) re-scored with the module's
// environmental settings.
// The environmental re-score of one finding, or null. A vector the calculator rejects, or
// a module without an environmental vector for the finding's CVSS version, answers null:
// one bad vector must not end the whole analysis.
Utils.getEnvironmentalInfo = async function (impact, environmental) {
  if(impact && impact.vectorString && environmental){
    let cvss;
    try {
      if(impact.cvssVersion && impact.cvssVersion === '4'){
        let v4 = new CvssCalculator.Cvss4P0(impact.vectorString)
        v4.applyVector(environmental.v4vectorString)
        cvss = v4.calculateScores(true)
      }
      if(impact.cvssVersion && impact.cvssVersion === '3'){
        let v3 = new CvssCalculator.Cvss3P1(impact.vectorString)
        v3.applyVector(environmental.v3vectorString)
        cvss = v3.calculateScores(true)
      }
      if(impact.cvssVersion && impact.cvssVersion === '2'){
        let v2 = new CvssCalculator.Cvss2(impact.vectorString)
        v2.applyVector(environmental.v2vectorString)
        cvss = v2.calculateScores(true)
      }
    } catch {
      return null
    }
    return environmental ? cvss : null
  }
  return null
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

Utils.createScanFromModule = async function (db, module, project, user){
  let versionData;
  const component = (module.infrastructureComponent || module.cotsComponent)
  const version = module.version || (component && component.version)
  let collection = 'components';
  if(component.key.indexOf('im:') === 0){
    collection = 'infrastructureComponents'
  }
  let componentData = await Utils.dbFindOne(db, collection, {key: component.key}, {projection:{logs:0}});
  if(componentData && version && Array.isArray(componentData.versions)){
    versionData = componentData.versions.find((entry) => {
      return entry && entry.version === version
    })
  }
  return {
    _id: 'GENERATED_SCAN',
    projectId : module.projectId,
    project : project && project.name || module.name,
    companyId: module.companyId,
    submitted: "2022-04-11T18:34:22.121Z",
    module: module.name,
    moduleId: module._id,
    moduleIdentifier: module.moduleIdentifier,
    user: (user.emails && user.emails[0] && user.emails[0].address) || user.profile.email,
    dependencyCount: 1,
    dependencies: [
      {
        name: component.name || module.name,
        key: component.key,
        versions: version ? [
          version
        ] : null,
        description: module.description,
        private: !component.public,
        licenses: versionData && versionData.licenses ? versionData.licenses : null,
        "dependencies" : []
      }
    ],
  }
}

export {
  Utils
};

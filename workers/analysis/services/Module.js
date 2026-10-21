import _ from 'underscore';

let Module = {};

function ComponentKey(key, parts) {
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
}

function ComponentRegExp(regexp) {
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
}

async function dbFind(db, collection, filter, limit, sort, projection) {
  return await db.collection(collection).find(filter || {}, projection || {}).limit(limit || 1).sort(sort || {}).toArray()
}

 
function findCompInArray(arr, key, version, all, path, selectedLicense) {
  if (!arr || !key) return false;

  if (version instanceof Array) {
    // eslint-disable-next-line sonarjs/cognitive-complexity
    return _.find(arr, function (entry) {
      const keyRegExp = new ComponentRegExp(entry.key+'$');
      const verRegExp = new ComponentRegExp(entry.version+'$');
      let selectedLicenseRegExp;
      if (entry.license && selectedLicense) {
        selectedLicenseRegExp = new ComponentRegExp(entry.license)
      }
      let matched = false;
      if (key.match(keyRegExp)) {
        for (let i = 0; i < version.length; i++) {
          const m = version[i].match(verRegExp);
          if (!all && m) {
            if (entry.path && path) {
              if (path === entry.path) {
                if (entry.license && selectedLicense) {
                  const value = typeof selectedLicense === 'string' ? selectedLicense :
                    (selectedLicense.key || selectedLicense.license || selectedLicense.name);
                  if (value?.match(selectedLicenseRegExp)) {
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
      const keyRegExp = new ComponentRegExp(entry.key+'$');
      const verRegExp = new ComponentRegExp(entry.version+'$');
      let matchedPath = true;
      let matchedSelectedLicense = true;
      if (entry.path && path) {
        matchedPath = path === entry.path;
      }
      if (entry.license && selectedLicense) {
        const value = typeof selectedLicense === 'string' ? selectedLicense :
          (selectedLicense.key || selectedLicense.license || selectedLicense.name);
        matchedSelectedLicense = value?.match(new ComponentRegExp(entry.license));
      }
      return key && key.match(keyRegExp) && (!entry.version || version === '*' || (version && version.match(verRegExp))) &&
        matchedPath && matchedSelectedLicense;
    });
  }
}


Module.isComponentBlacklisted = function (module, key, version) {
  const array = module.componentConfig && module.componentConfig.blacklist;
  return findCompInArray(array, key, version, false);
};
Module.isComponentWhitelisted = function (module, key, version) {
  const array = module.componentConfig && module.componentConfig.whitelist;
  return findCompInArray(array, key, version, true);
};
Module.isComponentUnchanged = function (module, key, version, path) {
  const array = module.componentConfig && module.componentConfig.unchanged;
  return findCompInArray(array, key, version, true, path);
};
Module.isComponentChangedStatus = function (module, key) {
  const array = module.componentConfig && module.componentConfig.changedStatus;
  return findCompInArray(array, key, '*', true);
};
Module.isComponentLooseCoupled = function (module, key, version, path) {
  const array = module.componentConfig && module.componentConfig.looseCoupled;
  return findCompInArray(array, key, version, true, path);
};
Module.isComponentCots = function (module, key, version, path) {
  const array = module.componentConfig && module.componentConfig.cots;
  return findCompInArray(array, key, version, true, path);
};
Module.isLicenseSelected = function (module, key, version, path, selectedLicense) {
  const array = module.componentConfig && module.componentConfig.licensesSelected;
  return findCompInArray(array, key, version, true, path, selectedLicense);
};
Module.isLicenseBlacklisted = function (module, licKey) {
  const lc = module.licenseConfig;
  return !!(lc && lc.blacklist && _.findWhere(lc.blacklist, {key: licKey}));
};
Module.isLicenseWhitelisted = function (module, licKey) {
  const lc = module.licenseConfig;
  return !!(lc && lc.whitelist && _.findWhere(lc.whitelist, {key: licKey}));
};
Module.isCveWhitelisted = function (module, cveKey, key, version, path) {
  const array = module.cveConfig && module.cveConfig.whitelist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};
Module.isCveBlacklisted = function (module, cveKey, key, version, path) {
  const array = module.cveConfig && module.cveConfig.blacklist;
  return _.find(array, function (entry) {
    return entry.cveKey === cveKey && (key ? entry.key === key : true) &&
      (version ? entry.version === version : true) && (path ? entry.path === path : true)
  });
};

const componentKeyOpts = {component: true, version: true};

Module.componentsChanged = function (module, compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new ComponentKey(comp, componentKeyOpts);
      return Module.isComponentUnchanged(module, key.component, key.version);
    }, this);
  }
  return true;
};

Module.componentsChangedStatus = function (module, compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new ComponentKey(comp, componentKeyOpts);
      return Module.isComponentChangedStatus(module, key.component, '*');
    }, this);
  }
  return true;
};

Module.componentsTightCoupled = function (module, compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new ComponentKey(comp, componentKeyOpts);
      return Module.isComponentLooseCoupled(module, key.component, key.version);
    }, this);
  }
  return true;
};

Module.componentsCots = function (module, compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new ComponentKey(comp, componentKeyOpts);
      return Module.isComponentCots(module, key.component, key.version);
    }, this);
  }
  return true;
};

Module.licensesSelected = function (module, compArray) {
  if (compArray && compArray instanceof Array) {
    return !_.every(compArray, function (comp) {
      const key = new ComponentKey(comp, componentKeyOpts);
      return Module.isLicenseSelected(module, key.component, '*');
    }, this);
  }
  return true;
};

Module.getAnalysis = async function (db, module, release, analysisId) {
  let filter= {
    moduleId: module._id
  };
  if(module.companyId){
    filter.companyId = module.companyId;
  }
  if(release){
    filter.release = release;
  }
  if(analysisId){
    filter._id = analysisId;
  }
  if(!release && !analysisId){
    filter.latest = true;
  }
  if(module.analysisObj && module.analysisObj._id === analysisId){
    return module.analysisObj
  } else {
    const analysis =  await dbFind(db, 'analysis', filter, 1, {'date': -1});
    if(analysis){
      return analysis[0]
    }
  }
};

Module.getStatistics = async function (db, module, analysisId) {
  const newAnalysisId = analysisId ? analysisId : module.analysisId || null;
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
    encryption: {
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
    }
  };
  if(module.statistics && (module.statistics.analysisId === newAnalysisId || !newAnalysisId)){
    data = module.statistics;
  }else{
    const analysis = await Module.getAnalysis(db, module, null, newAnalysisId);
    if(analysis && analysis.statistics){
      data = analysis.statistics
    }
  }
  return data;
};

Module.getWhitelistedLicenses = function (module) {
  return module.licenseConfig && module.licenseConfig.whitelist || [];
};

Module.getBlacklistedLicenses = function (module) {
  return module.licenseConfig && module.licenseConfig.blacklist || [];
};

Module.getWhitelistedCve = function (module) {
  return module.cveConfig && module.cveConfig.whitelist || [];
};

Module.getBlacklistedCve = function (module) {
  return module.cveConfig && module.cveConfig.blacklist || [];
};

Module.getWhitelistedComponents = function (module) {
  return module.componentConfig && module.componentConfig.whitelist || [];
};

Module.getBlacklistedComponents = function (module) {
  return module.componentConfig && module.componentConfig.blacklist || [];
};

Module.getUnchangedComponents = function (module) {
  return module.componentConfig && module.componentConfig.unchanged || [];
};

Module.getChangedStatusComponents = function (module) {
  return module.componentConfig && module.componentConfig.changedStatus || [];
};

Module.getLooseCoupledComponents = function (module) {
  return module.componentConfig && module.componentConfig.looseCoupled || [];
};

Module.getLicenseSelected = function (module) {
  return module.componentConfig && module.componentConfig.licensesSelected || [];
};

// Resolve an assigned license for a component that has NO detected license.
// 1) first licensesSelected entry that matches the component key (version '*',
//    path skipped - same matching as the legalAnalysis call site) and carries
//    a non-empty .license. Iterates entries so a license-less matching entry
//    cannot shadow a later one that has a .license.
// 2) root only: company.defaultRootComponentLicense, but only if that key still
//    exists in company.privateLicenses (name taken from that entry).
// Returns {key, name} or null. Pure: no I/O, no mutation.
Module.resolveAssignedLicense = function (module, company, componentKey, isRoot) {
  const entries = Module.getLicenseSelected(module);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry && entry.license && findCompInArray([entry], componentKey, '*', true, null, null)) {
      return { key: entry.license, name: entry.license };
    }
  }
  if (isRoot && company && company.defaultRootComponentLicense) {
    const key = company.defaultRootComponentLicense;
    const priv = _.find(company.privateLicenses || [], function (l) {
      return l && l.key === key;
    });
    if (priv) {
      return { key: key, name: priv.name || key };
    }
  }
  return null;
};


export { Module };

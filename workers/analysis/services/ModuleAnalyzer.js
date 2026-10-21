import _ from 'underscore';
import { v4 as uuidv4 } from 'uuid';
import { LogEvent } from './LogEvent.js';
import { Utils } from './Utils.js';
import { pathLocation, pathLicenses } from './paths.js';
import { Company } from './Company.js';
import { Project } from './Project.js';
import { Module } from './Module.js';
import { Statistics } from './Statistics.js';
import { Component } from './Component.js';
import { Version } from './Version.js';
import { Vulnerability } from './Vulnerability.js';
import { TSCheck } from './TSCheck.js';
import { getSettings } from './Settings.js';
import { osvSync } from './osv/sync.js';
import { pairId } from './osv/queries.js';
import moment from 'moment';
import semverSort from 'semver-sort';
import semver from 'semver';
import { mergeCiaRequirements } from './cia.js';

const ERROR_LOG = '=> an error occurred: ';
const FINISHED = 'Analysis finished';

const Analysis = function (companyId, moduleId, demo, lastAnalysis) {
  this.companyId = companyId;
  this.moduleId = moduleId;
  this.date = new Date();
  this.components = {};
  this.componentCache = {}; // hold Component objects identified by their key (e.g. mvn:groupId:artefactId)
  this.cvesCache = new Map(); // raw `cves` lookups keyed by the exact (key, versions) tuple, one query per component
  this.purls = new Map(); // pairId(key, version) -> the scan node's purl, for the OSV lookup
  this.licenses = {};
  this.moduleRequirements = {};
  this.ciaRequirements = {};
  this.viabilityConfig = {};
  this.ossfConfig = {};
  this.versioningConfig = {};
  this.algorithmsConfig = {};
  this.environmentalConfig = {};
  this.endoflifePolicy = {};
  this.confidenceMinScore = 4
  this.demo = demo;
  this.lastAnalysis = lastAnalysis;
  this.capabilities = [];
  this.statistics = {
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
    viability: {
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
    ossf: {
      warnings: 0,
      violations: 0
    },
    integrity: {
      warnings: 0,
      violations: 0
    },
    'multy-legal': {
      warnings: 0,
      violations: 0
    },
    endoflife: {
      warnings: 0,
      violations: 0
    },
    overall: {
      warnings: 0,
      violations: 0
    }
  };
};
function compVersions(comp) {
  return _.map(comp.versions, c => c.version);
}
function isWhitelisted(license,company,project,module) {
  return Company.isLicenseWhitelisted(company, license.key) || (typeof Project.isLicenseWhitelisted === 'function' &&
    Project.isLicenseWhitelisted(project, license.key)) || Module.isLicenseWhitelisted(module, license.key)
}
function isCveWhitelisted(cveKey, key, version, company, project, module) {
  return Company.isCveWhitelisted(company, cveKey, key, version) || (typeof Project.isCveWhitelisted === 'function' &&
    Project.isCveWhitelisted(project, cveKey, key, version)) || Module.isCveWhitelisted(module, cveKey, key, version)
}
function isLicenseSelected(module, component, version, path, selectedLicense) {
  return module && Module.isLicenseSelected &&
    Module.isLicenseSelected(module, component, version, path, selectedLicense);
}
// Whether a dependency node carries something a component can be looked up by.
//
// A scan node with neither `key` nor `purl` is one ts-app could not
// identify either. Since ts-app 3.2.69 it records the node in the scan's
// `skippedDependencies` and deliberately LEAVES IT IN THE STORED TREE, so the loss stays
// visible and `dependencyCount` stays honest - and this service reads that stored tree.
// One such node used to cost the whole module its analysis: its undefined key reached
// `loadComponent`, where `key.indexOf('im:')` throws. How that surfaced depended on the
// phase. `integrityAnalysis` and `legalAnalysis` walk the tree through `eachDependency`,
// which is SYNCHRONOUS and never awaits the async callback it is given, so the TypeError
// had no handler at all and ended the invocation - the "Runtime exited with error:
// exit status 1" reported on the issue. The phases that walk the working set through
// `eachComponent` do await it, and there the same TypeError merely aborted the run with
// no analysis document written. Either way, twenty valid dependencies next to one
// unidentifiable one produced nothing. The node is skipped instead: it contributes no
// component and no license, and everything around it is analysed as usual.
function hasUsableKey(dependency) {
  return !!(dependency && typeof dependency.key === 'string' && dependency.key);
}
function removeEmpty(obj) {
  Object.keys(obj).forEach(k =>
    (obj[k] && typeof obj[k] === 'object') && removeEmpty(obj[k]) ||
    (!obj[k] && obj[k] !== undefined) && delete obj[k]
  );
  return obj;
}
// A scan carries its declared licenses in whatever shape the importer wrote them:
// {key, name} objects, but SBOM/CycloneDX imports use bare strings. Version.getLicenses
// assigns `selected` onto every entry it walks, which throws on a string primitive, so
// bring them to a dense array of license objects before they enter the working set.
// Copies, not the scan's own objects, so that assignment never reaches the scan document.
function normalizeLicenses(licenses) {
  const normalized = [];
  _.each(licenses || [], function (lic) {
    if (typeof lic === 'string' || lic instanceof String) {
      const key = String(lic);
      if (key) normalized.push({key: key, name: key});
    } else if (lic && typeof lic === 'object' && (lic.key || lic.name)) {
      normalized.push(_.clone(lic));
    }
  });
  return normalized;
}

// The marker ts-app stamps on a license a compliance manager set BY HAND for a
// component the scan could not match. Defined in ts-app's
// imports/server/scan/rootDependency.js, alongside the root picker's own
// 'ts-root-pick' - the two are deliberately distinct and only this one is
// authoritative for an arbitrary component.
//
// The scan is the ONLY channel it travels on: ts-app strips marked entries from
// every write onto the shared `components` catalogue (a per-company, often
// private, license key must never reach a document every tenant reads), so
// nothing downstream can rediscover the pick from the component record. If it is
// dropped here it is gone.
const COMPONENT_PICK_ORIGIN = 'ts-component-pick';

// The manual pick among a dependency's licenses, normalised, or null.
//
// FIRST ONE WINS, and there is only ever one: ts-app drops every previously
// injected entry before it unshifts the current pick, so markers cannot
// accumulate across runs.
function componentPick(licenses) {
  const picked = _.find(licenses || [], function (lic) {
    return !!lic && typeof lic === 'object' && lic.origin === COMPONENT_PICK_ORIGIN;
  });
  return picked && normalizeLicenses([picked])[0] || null;
}

// The licenses a scan dependency contributes to the working set, or null.
//
// A MANUAL PICK IS AUTHORITATIVE and replaces everything else on the node. That
// is the whole point of the feature: the picker is offered exactly when the
// scanner's own declaration is missing or could not be matched, so carrying both
// would answer "Component include two or more licenses" instead of the licence a
// human determined. It also has to bypass the versions rule below - every
// ordinary dependency has versions, so without this the pick reached nothing.
//
// Everything else keeps the original rule: an ordinary dependency's licenses come
// back with its component record anyway, so they are carried only when it has no
// versions. The scan ROOT is the other exception - ts-app's applyRootLicense
// writes the picked license into the scan and nothing writes it onto the shared
// catalogue, so for a versioned root the pick would be dropped (3.7.6).
function declaredScanLicenses(dependency, isRoot) {
  if (!dependency.licenses || !dependency.licenses.length) return null;
  const picked = componentPick(dependency.licenses);
  if (picked) return [picked];
  if (!isRoot && dependency.versions && dependency.versions.length) return null;
  const licenses = normalizeLicenses(dependency.licenses);
  return licenses.length ? licenses : null;
}

// Write a manual pick gathered from the scan onto a component record, OVERRIDING
// whatever that record says.
//
// Every other bridge between the working set and a component record is fill-only,
// and rightly so - an assigned license must not speak over a real one. A manual
// pick is the exception, because the population it is offered for is precisely
// the component that already carries a license nobody could match: fill-only
// would leave that unmatchable entry in place and the determination would do
// nothing. Both `declaredLicenses` and the version's own licenses are set,
// because Version.getLicenses prefers version.licenses and would otherwise keep
// answering with what it replaced.
//
// Only the versions the pick was actually gathered for are touched; another
// version of the same component keeps its own licenses.
//
// @returns {Boolean} whether a pick was found and applied
function applyComponentPick(component, workingSetVersions) {
  let picked = null;
  _.each(workingSetVersions || [], function (wv) {
    picked = picked || componentPick(wv && wv.licenses);
  });
  if (!picked) return false;
  component.declaredLicenses = [picked];
  component.versions = component.versions || [];
  _.each(workingSetVersions || [], function (wv) {
    if (!wv || !wv.version || !componentPick(wv.licenses)) return;
    const existing = _.findWhere(component.versions, {version: wv.version});
    if (existing) {
      existing.licenses = wv.licenses;
    } else {
      component.versions.push({version: wv.version, licenses: wv.licenses});
    }
  });
  return true;
}

function getJumpStatus(analysis, componentKey, versions){
  let status = 'ok'
  let detail
  if(analysis){
    const pastComp = analysis.components.find((comp)=>{
      return comp.key === componentKey
    })
    // lastAnalysis is persisted data we cannot retroactively clean: legacy docs
    // (pre-"empty version in dependency") stored object-typed `version` values.
    // Coerce every version to a strict semver string and drop anything semver
    // cannot parse before handing it to semver.gt / semver.diff / .split('.').
    const toSemver = (list) => semverSort.desc(
      (list || []).map((v) => semver.valid(semver.coerce(v))).filter(Boolean)
    )
    const pastVersions = pastComp && toSemver(pastComp.versions.map((ver) =>{
      return ver.version
    }))
    const currVersions = toSemver(versions)
    if(currVersions.length && pastVersions && pastVersions.length && JSON.stringify(pastVersions) !== JSON.stringify(currVersions) && semver.gt(currVersions[0], pastVersions[0])){
      const parts = pastVersions[0].split('.')
      parts[0] = +parts[0] + 1
      const comparedVersion = parts.join('.')
      if(semver.diff(currVersions[0], comparedVersion) === 'major'){
        status = 'violations'
        detail = {
          past: pastVersions[0],
          curr: currVersions[0]
        }
      }
    }
  }
  return {status, detail}
}
function processVersioning(self, comp, component, module, versions){
  const allVersions = Component.findAllVersions(component);
  const status = Component.getVersioningStatus(component, module, versions, allVersions);
  if (status === 'warnings' || status === 'violations') {
    const latest = allVersions && allVersions.length > 0 ?
      allVersions[allVersions.length -1] : false;
    self.addComponentError('versioning', status, 'New version(s) for this component is available. Latest version is '+
      latest, comp.key, versions[versions.length - 1], {latest});
  }
}
function processEncryption(self, comp, algorithms, versions, algorithmsConfig){
  let status = 'ok'
  const extra = []
  for (let i = 0; i < algorithmsConfig.length; i++) {
    let item = algorithmsConfig[i]
    if(algorithms.indexOf(item.key.toLowerCase()) > -1){
      if(item.exportStrict && item.exportStrict.length){
        status = 'violations'
        extra.push(item)
      }else if(item.exportWeak && item.exportWeak.length){
        status = 'warnings'
        extra.push(item)
      }
    }
  }
  if (status === 'violations') {
    self.addComponentError('encryption', status, 'Algorithm is marked as Strict for Export', comp.key, versions[versions.length - 1], extra);
  }else if (status === 'warnings') {
    self.addComponentError('encryption', status, 'Algorithm is marked as Weak for Export', comp.key, versions[versions.length - 1], extra);
  }
}
// Merge the working-set versions gathered from the scan into a component record read
// back from the database. Fill-only: a version missing from the record is added (e.g.
// the synthetic 0.0.0 seeded for scan-root deps), a version present but carrying no
// licenses takes the working set's, and a version that already has licenses is left alone.
//
// The fill is what carries an assigned license into the legal check: rebuildModuleObject
// builds that request from this record - a fresh dbFindOne that never sees the
// declaredLicenses bridge loadComponent applies - so without it the check was asked about
// an unlicensed component, answered nothing, and the component came back "unknown".
function mergeWorkingSetLicenses(component, workingSetVersions) {
  component.versions = component.versions || [];
  const versions = component.versions;
  // A manually set license is not a fill: it replaces whatever the
  // record carries, on this record too, so the check request asks about the
  // license a human determined rather than the one nobody could match. It has
  // already written every version it covers, so the fill below is skipped.
  if (!applyComponentPick(component, workingSetVersions)) {
    // A license on ANY version or in declaredLicenses counts (the same test the
    // declaredLicenses bridge in loadComponent applies). Computed before the loop so
    // filling one version cannot block filling another in the same pass.
    const componentHasLicense = (component.declaredLicenses && component.declaredLicenses.length) ||
      _.some(versions, function (v) { return v.licenses && v.licenses.length; });
    _.each(workingSetVersions || [], function (pv) {
      if (!pv || !pv.version) return;
      const existing = _.findWhere(versions, {version: pv.version});
      const hasLicenses = pv.licenses && pv.licenses.length;
      if (!existing) {
        const added = {version: pv.version};
        if (hasLicenses) added.licenses = pv.licenses;
        versions.push(added);
        return;
      }
      if (hasLicenses && !componentHasLicense) {
        existing.licenses = pv.licenses;
      }
    });
  }
  return component;
}

async function getModuleComponents(db, companyId, module, listComponents) {
  const startTime = new Date();
  if (module) {
    let components = listComponents || [];
    components = components.map(async (projComp) => {
      let collection = 'components';
      if(projComp.key.indexOf('im:') === 0){
        collection = 'infrastructureComponents'
      }
      let component = await Utils.dbFindOne(db, collection, {$or:[{key: projComp.key}, {oldKey: projComp.key}]}, {projection:{logs:0}});
      if (component) {
        const data = component;
        const usedVersions = _.map(projComp.versions, c => c.version);
        // Carry the scan's working-set versions and their licenses onto the DB record
        // (fill-only; see mergeWorkingSetLicenses). Must run BEFORE the used-versions
        // filter: the fill guard has to see licenses on versions this scan does not use.
        mergeWorkingSetLicenses(data, projComp.versions);
        data.versions = _.filter(data.versions, function (v) {
          return usedVersions.indexOf(v.version) >= 0;
        });
        Component.findVulnerabilities(db, component, companyId);
        data.problems = projComp.problems;

        projComp.versions.forEach(function (v) {
          const version = Component.findVersion(component, v.version);
          if (version) {
            version.paths = v.paths;
          }
        });
        return data;
      } else {
        console.info('=> getModuleComponents(%s): %s, component not found: %s', module._id, module.name, projComp.key);
      }
    });
    await Promise.all(components).then((values) => {
      components = _.compact(values);
      console.info('=> getModuleComponents: took %s millis', new Date() - startTime);
    });
    return components;
  } else {
    console.info('=> getModuleComponents(%s): no module found: ', module._id);
    return [];
  }
}
function logDuration( logData,funcName ){
  let newTime = new Date()
  let pastTime = logData[funcName]
  if(!pastTime){
    logData[funcName] = newTime
  }else{
    console.info(`=> analyzeModule.${funcName}: took %s millis`, newTime - pastTime);
  }
}

Analysis.prototype.eachDependency = function (scan, callback) {
  const self = this;

  function walk(dependency, path) {
    if (dependency) {
      callback.call(self, dependency, path || '/');

      if (dependency.dependencies instanceof Array) {
        _.each(dependency.dependencies, function (d) {
          const key = new Utils.ComponentKey(d.key, {mgr: 1, component: 1});
          walk(d, path + '/' + key.component + ':' + (d.versions && d.versions[0] || d.versions));
        });
      }
    }
  }

  if (scan && scan.dependencies instanceof Array) {
    _.each(scan.dependencies, function (d) {
      walk(d, '');
    });
  }
};

Analysis.prototype.eachComponent = async function (db, module, project, company, callback) {
  const self = this;
  for (let key in this.components) {
    const component = self.components[key];
    const compObject = await self.getComponent(db, component.key, module, false, component, project, company);
    await callback.call(self, component, compObject, self);
  }
};

Analysis.prototype.getComponent = function (db, key, module, custom, dependency, project, company) {
  const self = this;
  // An unusable key never reaches the cache: it is not a component, so a slot keyed
  // `undefined` would only be a lookup nothing can ever match. Returning
  // null rather than a promise of null also means the one caller that tests the return
  // value WITHOUT awaiting it - gatherComponents - reads it correctly.
  if (typeof key !== 'string' || !key) {
    return null;
  }
  // Return the cached lookup (a Promise) if we already have one. Caching the
  // in-flight Promise - and assigning it SYNCHRONOUSLY below, before the first
  // await - lets concurrent callers for the same key share ONE DB lookup. Without
  // this, a synchronous burst of calls (e.g. gatherComponents walking thousands of
  // dependency-tree nodes in one pass) all observe an empty cache and stampede the
  // connection pool with a duplicate query per node instead of one per unique key.
  if (self.componentCache[key] !== undefined) {
    return self.componentCache[key];
  }
  const promise = self.loadComponent(db, key, module, custom, dependency, project, company);
  // Don't cache a rejected lookup: drop it so a later call can retry (matches the
  // pre-cache behaviour where a thrown dbFind left the cache untouched).
  promise.catch(() => {
    if (self.componentCache[key] === promise) {
      delete self.componentCache[key];
    }
  });
  self.componentCache[key] = promise;
  return promise;
};

// Actual DB load for a single component key. Kept separate from getComponent so
// the cache (a synchronously-stored Promise) can dedupe concurrent callers; this
// is only ever invoked on a cache miss.
Analysis.prototype.loadComponent = async function (db, key, module, custom, dependency, project, company) {
  const self = this;
  // No key, no lookup. The callers below skip such a node before they get here; this is
  // what keeps a caller that does not from taking the whole analysis down.
  if (typeof key !== 'string' || !key) {
    return null;
  }
  let collection = 'components';
  if(key.indexOf('im:') === 0){
    collection = 'infrastructureComponents'
  }
  let comp = {};
  let projection = {logs:0, crawlerInfo:0}
  if((module && module.viabilityConfig && module.viabilityConfig.enabled) || (module && module.ossfConfig && module.ossfConfig.enabled)
      || (module && module.endoflifePolicy && module.endoflifePolicy.enabled) || (project && project.endoflifePolicy && project.endoflifePolicy.enabled)
      || (company && company.endoflifePolicy && company.endoflifePolicy.enabled)){
    projection = {logs:0}
  }
  if(!custom){
    const companyRestriction = {$or: [{companyIds: {$exists: false}},
      {companyIds: {$exists: true,$size: 0}}, {companyIds: self.companyId}]};
    const compRaw = await Utils.dbFind(db, collection, {$and: [{key: key}, companyRestriction]}, 1, null, {projection: projection});
    comp = compRaw && compRaw[0] || null;
  }else{
    const compRaw = await Utils.dbFind(db, collection, {key: key}, 1, null, {projection: projection});
    comp = compRaw && compRaw[0] || null;
  }
  if(!comp){
    // Nothing in the catalogue this company may read. declaredScanLicenses() drops a
    // versioned dependency's own licenses on the premise that they "come back with its
    // component record anyway" - which only holds when a record was actually found. A
    // record can exist and still be invisible here, because the lookup above is scoped
    // by companyIds: a component another company catalogued is not readable, and the
    // stub built here used to carry no licenses at all. The result was that the first
    // scan of a new company analysed EVERY component as "License could not be matched
    // correctly", even when the SBOM declared one. Fall back to what the scan declared.
    const declared = normalizeLicenses(dependency && dependency.licenses);
    comp = {
      _id: 'SOME_ID',
      key: key,
      name: dependency.name || key,
      urls: {},
      versions: dependency.versions ? dependency.versions.map(v=> {
        return declared.length ? {version: v, licenses: declared} : {version: v}
      }): [],
      private: false
    }
    if (declared.length) {
      comp.declaredLicenses = declared;
    }
  }
  // Scan-root case: dependency has no versions but carries declared licenses.
  // Seed the component with a synthetic 0.0.0 version and merge the dep's
  // licenses into declaredLicenses (the dep may carry private licenses that
  // aren't in the DB component's declaredLicenses).
  if (dependency && (!dependency.versions || !dependency.versions.length)
      && dependency.licenses && dependency.licenses.length) {
    comp.declaredLicenses = comp.declaredLicenses || [];
    _.each(normalizeLicenses(dependency.licenses), function (depLic) {
      const exists = _.find(comp.declaredLicenses, function (compLic) {
        return (depLic.key && compLic.key === depLic.key)
            || (depLic.name && compLic.name === depLic.name);
      });
      if (!exists) {
        comp.declaredLicenses.push(depLic);
      }
    });
    if (!comp.versions) comp.versions = [];
    if (!_.findWhere(comp.versions, {version: '0.0.0'})) {
      comp.versions.push({version: '0.0.0'});
    }
  }
  // Assigned-license bridge: gatherComponents may have resolved an assigned
  // license onto the working-set version entries (this.components[key]) for a
  // component the scan declared no license for. legalAnalysis resolves via
  // Version.getLicenses(version, comp.declaredLicenses, ...), so surface those
  // working-set licenses through declaredLicenses - fill-only: only when the
  // DB component carries no license of its own (real version.licenses still
  // take priority in Version.getLicenses, so a licensed component is untouched).
  const wsComp = self.components && self.components[key];
  // A manual pick first, and unconditionally: it is the one assigned license that
  // must speak over what the record already carries (see applyComponentPick).
  if (wsComp && applyComponentPick(comp, wsComp.versions)) {
    return comp;
  }
  if (wsComp && wsComp.versions && wsComp.versions.length) {
    const compHasLicense = (comp.declaredLicenses && comp.declaredLicenses.length)
      || _.some(comp.versions || [], function (v) { return v.licenses && v.licenses.length; });
    if (!compHasLicense) {
      _.each(wsComp.versions, function (wv) {
        _.each(wv.licenses || [], function (lic) {
          comp.declaredLicenses = comp.declaredLicenses || [];
          const exists = _.find(comp.declaredLicenses, function (cl) {
            return (lic.key && cl.key === lic.key) || (lic.name && cl.name === lic.name);
          });
          if (!exists) {
            comp.declaredLicenses.push(lic);
          }
        });
      });
    }
  }
  return comp;
};

Analysis.prototype.addComponentError = function (category, status, message, key, version, extra, notCount) {
  const component = this.components[key];
  if (component) {
    if (category !== 'endoflife' && category !== 'integrity' && category !== 'legal' && category !== 'ossf' &&
        category !== 'viability' && category !== 'versioning' && category !== 'vulnerability' && category !== 'encryption'
        || status !== 'warnings' && status !== 'violations' && status !== 'ok'  || !message) {
      throw new Error('wrong arguments', arguments);
    }
    component.problems = component.problems || {};
    component.problems[category] = component.problems[category] || [];

    const problem = {status: status, message: message};
    if (version) {
      problem.version = version;
    }
    if (extra) {
      problem.extra = extra;
    }
    component.problems[category].push(problem);

    if (status === 'violations' || status === 'warnings') {
      component.status = status;
    }
    if(!notCount){
      this.statistics[category][status]++;
    }
  }
};

Analysis.prototype.addComponentInfo = function (category, key, info) {
  const component = this.components[key];
  if (component) {
    if (category !== 'ossf' && category !== 'viability') {
      throw new Error('wrong arguments', arguments);
    }
    component.info = component.info || {};
    component.info[category] = info;
  }
};

Analysis.prototype.gatherComponents = function (db, scan, module, project, company) {
  const self = this;
  let compCount = 0;
  let customComponents = {
    module: module.name,
    moduleId: module._id,
    dependencies: module.customComponents,
    companyId: module.companyId
  };
  function deepScanIdFor(dependency, version) {
    const metaVersions = dependency.meta && dependency.meta.versions;
    if (!metaVersions || !metaVersions.length) return null;
    if (version) {
      const m = _.findWhere(metaVersions, {version: version});
      if (m && m.deepScanId) return m.deepScanId;
    }
    // top-level deps may carry deepScanId in meta while dependency.versions is empty -
    // fall back to the only meta entry's deepScanId so the dependency view can surface it
    return metaVersions.length === 1 && metaVersions[0].deepScanId || null;
  }
  function buildVersionEntry(version, path, deepScanId, depLicenses) {
    const entry = {version: version, paths: [path], deepScanId: deepScanId};
    if (depLicenses) entry.licenses = depLicenses;
    return entry;
  }
  function mergeIntoExistingVersion(v, path, deepScanId, depLicenses) {
    v.paths.push(removeEmpty(path));
    if (deepScanId && !v.deepScanId) v.deepScanId = deepScanId;
    // A manual pick overrides what an earlier occurrence of the same version put
    // here; anything else is still first-one-wins.
    if (depLicenses && (!v.licenses || componentPick(depLicenses))) v.licenses = depLicenses;
  }
  function forDependency(dependency, path, custom) {
    if(dependency.key && dependency.key.indexOf('mvn') === 0){
      dependency.key = 'maven' + dependency.key.slice(3)
    }
    if(dependency.purl && dependency.purl.indexOf('pkg:mvn') === 0){
      dependency.purl = 'pkg:maven' + dependency.purl.slice(7)
    }
    // Skipped before the lookup, because `component` here is the PROMISE getComponent
    // returns and every promise is truthy: an unidentifiable node would otherwise be
    // entered into the working set under an undefined key and counted as a component the
    // module has, and every later phase that walks the working set (eachComponent) would
    // then hand that undefined key back to loadComponent.
    if (!hasUsableKey(dependency)) {
      return;
    }
    const component = self.getComponent(db, dependency.key, module, custom, dependency, project, company);
    if (component) {
      const key = dependency.key;
      const version = (dependency.versions && dependency.versions[0]) || '0.0.0';
      if (typeof dependency.purl === 'string' && dependency.purl) {
        const purlKey = pairId(key, version);
        if (!self.purls.has(purlKey)) {
          self.purls.set(purlKey, dependency.purl);
        }
      }
      const deepScanId = deepScanIdFor(dependency, version);
      const isRoot = path === '/' && !custom;
      let depLicenses = declaredScanLicenses(dependency, isRoot);
      if (!depLicenses && !(dependency.licenses && dependency.licenses.length)) {
        const assigned = Module.resolveAssignedLicense(module, company, dependency.key, isRoot);
        if (assigned) {
          depLicenses = [assigned];
        }
      }

      if (!self.components[key]) {
        self.components[key] = removeEmpty({
          key: key,
          versions: [buildVersionEntry(version, path, deepScanId, depLicenses)],
          status: 'ok'
        });
        if(isRoot){
          self.components[key].root = true
        }else if((path.split('/').length - 1) === 1 && !custom){
          self.components[key].firstLevel = true
        }
        if(dependency.meta){
          self.components[key].meta = dependency.meta
        }
        compCount++;
      } else {
        const comp = self.components[key];
        const v = _.findWhere(comp.versions, {version: version});
        if (v) {
          mergeIntoExistingVersion(v, path, deepScanId, depLicenses);
        } else {
          comp.versions.push(removeEmpty(buildVersionEntry(version, path, deepScanId, depLicenses)));
        }
      }
    }
  }
  self.eachDependency(customComponents, function(dependency, path){
    forDependency(dependency, path, true)
  });
  self.eachDependency(scan, function (dependency, path) {
    forDependency(dependency, path)
  });
  self.statistics.components = compCount;
};

Analysis.prototype.legalAnalysis = async function (db, scan, module, requireWhitelist, project, company) {
  const self = this;
  // A component-version's paths are aggregated once onto self.components during
  // gatherComponents, so processing it is identical no matter which dependency-tree
  // node we reach it from. The scan walk below visits every node (a component can
  // appear thousands of times), so without this guard each (key, version) would be
  // re-evaluated once per occurrence - O(occurrences^2) license work over the same
  // paths - and addLicense would pile up that many duplicate component entries.
  // Evaluate each (key, version) exactly once.
  const processedVersions = new Set();

  function addLicense(licKey, licName, componentItem) {
    const foundLicense = self.licenses[licKey];
    if (foundLicense) {
      if (_.indexOf(foundLicense.components, componentItem) === -1) { // not in components array
        foundLicense.components.push(removeEmpty(componentItem));
      }
    } else {
      self.licenses[licKey] = {key: licKey, name: licName, components: [removeEmpty(componentItem)]};
    }
  }
   
  async function forDependency(dependency, custom) {
    // eachDependency is synchronous and does not await this callback, so a rejection here
    // has no handler and ends the whole invocation. A node with no key contributes no
    // license, exactly as it contributed no component.
    if (!hasUsableKey(dependency)) {
      return;
    }
    const component = await self.getComponent(db, dependency.key, module, custom, dependency);
    if (component) {
      let isLicenseFound = false;
      const depVersion = (dependency.versions && dependency.versions[0]) || '0.0.0';
      const version = Component.findVersion(component, depVersion);
      if (version && !Module.isComponentWhitelisted(module, component.key, version.version)) {
        const versionKey = component.key + '@' + version.version;
        if (processedVersions.has(versionKey)) {
          return;
        }
        processedVersions.add(versionKey);
        let componentItem = _.find(self.components, function (componentItem) {
          return componentItem.key === component.key
        });
        let versionItem = _.find(componentItem.versions, function (versionItem) {
          return versionItem.version === version.version
        });
        _.each(versionItem.paths, function (path) {
          // `paths` entries are strings on every analysis this worker writes; only much
          // older records carry {path, licenses}. Accept both, or every license component
          // is stored with path: null.
          const location = pathLocation(path);
          let listLicenses = Version.getLicenses(version, component.declaredLicenses, module, component.key);
          let selectedLicense = false;
          if(listLicenses.length > 1){
            // skip unmatched licenses if valid one available
            const tmpListLicenses = listLicenses.filter((license)=>{
              return license.key
            })
            if(tmpListLicenses.length > 0){
              listLicenses = tmpListLicenses
            }
            _.each(listLicenses, function (license) {
              if(isLicenseSelected(module, component.key, '*', null, (license.key || license.name))){
                selectedLicense = (license.key || license.name);
              }
            });
          }
          if(!selectedLicense && listLicenses.length > 1){
            addLicense('unknown', 'unknown', {
              componentKey: component.key,
              version: version.version,
              requireWhitelist: requireWhitelist ? isWhitelisted('unknown', company, project, module) : undefined,
              path: location,
              status: {'status' : 'warnings','reason' : 'Component include two or more licenses'},
              privateLicense: false
            });
          }else{
            if(!selectedLicense && listLicenses.length === 1){
              listLicenses = _.sortBy(listLicenses,'key');
              selectedLicense = (listLicenses[0].key || listLicenses[0].name)
            }
            _.each(listLicenses, function (license) {
              if((selectedLicense && (selectedLicense === license.key || selectedLicense === license.name))){
                if (license.key || license.name) {
                  isLicenseFound = true;
                  // eslint-disable-next-line sonarjs/no-nested-functions
                  let status = _.find(pathLicenses(path), function (pathLicense) {
                    return pathLicense.key === license.key || pathLicense.key === license.name
                  });
                  let privateLicense = false;
                   
                  // eslint-disable-next-line sonarjs/no-nested-functions
                  privateLicense = _.any(company.privateLicenses, function (privateLicenseItem) {
                    return privateLicenseItem.key === license.key || privateLicenseItem.key === license.name
                  });
                  if(requireWhitelist){
                    license.requireWhitelist = isWhitelisted(license, company, project, module);
                  }
                  addLicense((license.key || license.name), (license.name || license.key), {
                    componentKey: component.key,
                    version: version.version,
                    path: location,
                    status: status && status.status,
                    requireWhitelist: license.requireWhitelist,
                    privateLicense: privateLicense
                  });
                }else{
                  addLicense('unknown', 'unknown', {
                    componentKey: component.key,
                    version: version.version,
                    requireWhitelist: requireWhitelist ? isWhitelisted('unknown', company, project, module) : undefined,
                    path: location,
                    status: {'status' : 'warnings','reason' : 'License could not be matched correctly'},
                    privateLicense: false
                  });
                }
              }
            });
            if (isLicenseFound === false) {
              addLicense('unknown', 'unknown', {
                componentKey: component.key,
                version: version.version,
                requireWhitelist: requireWhitelist ? isWhitelisted('unknown', company, project, module) : undefined,
                path: location,
                status: {'status' : 'warnings','reason' : 'License could not be matched correctly'},
                privateLicense: false
              });
            }
          }
        });
      }
    }
  }
  let customComponents = {
    module: module.name,
    moduleId: module._id,
    dependencies: module.customComponents,
    companyId: module.companyId
  };
  await self.eachDependency(customComponents, async function (dependency) {
    await forDependency(dependency, true)
  });

  await self.eachDependency(scan, async function (dependency) {
    await forDependency(dependency)
  });
};

// Refreshes the `cves` cache from OSV for this module's components before
// vulnerabilityAnalysis reads it (workers/analysis/services/osv). Whitelisted components
// are skipped, as vulnerabilityAnalysis skips them.
Analysis.prototype.osvSync = function (db, module) {
  return osvSync(db, {
    components: this.components,
    purls: this.purls,
    skip: (key, versions) => Module.isComponentWhitelisted(module, key, versions),
    settings: getSettings()
  });
};

Analysis.prototype.vulnerabilityAnalysis = async function (db, module, project, company) {
  const self = this;
  self.confidenceMinScore = module.confidenceMinScore || (project && project.confidenceMinScore) || 4
  const allManualVulns = await Utils.dbFind(db,'manualVulnerabilities',{ companyId: company._id }, 1000, null, {projection:{ecs: 1, vuln: 1}})
  if(module.environmentalConfig && Object.keys(module.environmentalConfig).length){
    self.environmentalConfig = module.environmentalConfig;
  }

  await self.eachComponent(db, module, project, company, async function (comp) {
    const versions = compVersions(comp);
    if (!Module.isComponentWhitelisted(module, comp.key, versions)) {
      await Vulnerability.findAll(db, comp.key, versions, self.companyId, allManualVulns, self.cvesCache).then(async (res) => {
        let vulns = res;
        vulns = _.map(_.groupBy(vulns, function (vuln) {
          return Vulnerability.getName(vuln)
        }), function (vulnList) {
          let vuln = vulnList[0];
          // eslint-disable-next-line sonarjs/no-nested-functions
          vuln.vulnVersions = _.flatten(_.map(vulnList, function (oneVuln) {
            return oneVuln.version
          }));
          vuln.isWhitelisted = isCveWhitelisted(Vulnerability.getName(vuln), comp.key, false, company, project, module);
          return vuln
        });
        await Promise.all(vulns.map(async function (vuln) {
          // Only a scored finding with a vector can be re-scored for the module's environment.
          if(vuln && vuln.vuln && typeof vuln.vuln.baseScore === 'number' && vuln.vuln.vectorString &&
            self.environmentalConfig && Object.keys(self.environmentalConfig).length){
            vuln.environmental = await Utils.getEnvironmentalInfo(vuln.vuln, self.environmentalConfig)
          }
          let extra = {
            cvssColor: Vulnerability.getCVSSColor(vuln),
            vector: Vulnerability.getVector(vuln),
            link: Vulnerability.getLink(vuln),
            severity: Vulnerability.getSeverity(vuln),
            confidence: Vulnerability.getConfidence(vuln),
            cisa: Vulnerability.getCisa(vuln),
            isWhitelisted: !!vuln.isWhitelisted,
            environmental: !!vuln.environmental,
            score: +(!isNaN(Vulnerability.getScore(vuln)) ? Vulnerability.getScore(vuln).toFixed(1) : +Vulnerability.getScore(vuln))
          };
          if(vuln.environmental){
            extra.base = vuln.environmental.base
          }
          self.addComponentError('vulnerability', Vulnerability.getScoreLabel(vuln),
            Vulnerability.getName(vuln),
            comp.key, vuln.vulnVersions[0], extra, true);
          vuln.vuln = extra
          return vuln
        }));
      });
    }
  });
};

Analysis.prototype.ciaAnalysis = function (db, module, project) {
  const self = this;

  // The project's requirements are a minimum the module can only raise.
  self.ciaRequirements = mergeCiaRequirements(project && project.ciaRequirements, module.ciaRequirements);
};

Analysis.prototype.viabilityAnalysis = async function (db, module, project, company) {
  const self = this;

  if(module && module.viabilityConfig && module.viabilityConfig.enabled){
    self.viabilityConfig = module.viabilityConfig;
    await self.eachComponent(db, module, project, company, function (comp, component) {
      const versions = compVersions(comp);
      self.addComponentInfo('viability', comp.key, Component.getViability(component))
      if (!Module.isComponentWhitelisted(module, comp.key, versions)) {
        const status = Component.getViabilityStatus(component, self.viabilityConfig);
        if (status === 'warnings' || status === 'violations') {
          self.addComponentError('viability', status, 'starCount to low', comp.key);
        }
      }
    });
  }
};

Analysis.prototype.ossfAnalysis = async function (db, module, project, company) {
  const self = this;

  if(module && module.ossfConfig && module.ossfConfig.enabled){
    self.ossfConfig = module.ossfConfig;
    await self.eachComponent(db, module, project, company, function (comp, component) {
      const versions = compVersions(comp);
      self.addComponentInfo('ossf', comp.key, Component.getOSSF(component))
      if (!Module.isComponentWhitelisted(module, comp.key, versions)) {
        const status = Component.getOssfStatus(component, self.ossfConfig);
        if (status === 'warnings' || status === 'violations') {
          self.addComponentError('ossf', status, 'score to low', comp.key);
        }
      }
    });
  }
};

Analysis.prototype.versioningAnalysis = async function (db, module, project, company) {
  const self = this;

  if(module && module.versioningConfig && module.versioningConfig.enabled){
    self.versioningConfig = module.versioningConfig;
    await self.eachComponent(db, module, project, company, function (comp, component) {
      const versions = compVersions(comp);
      if (!Module.isComponentWhitelisted(module, comp.key, versions)) {
        if(module.versioningConfig.jump){
          const jumpDetails = getJumpStatus(self.lastAnalysis, comp.key, versions)
          if(jumpDetails && jumpDetails.status === 'violations'){
            self.addComponentError('versioning', jumpDetails.status, 'PLEASE NOTE: The change of the component version seems to be unusually high. ' +
                'Please verify that this build uses the intended latest version. '+ `(${jumpDetails.detail.past} -> ${jumpDetails.detail.curr})`, comp.key, versions[versions.length - 1], jumpDetails.detail);
          }else{
            processVersioning(self, comp, component, module, versions)
          }
        }else{
          processVersioning(self, comp, component, module, versions)
        }
      }
    });
  }
};

Analysis.prototype.endoflifeAnalysis = async function (db, module, project, company) {
  const self = this;

  let endoflifePolicy = company.endoflifePolicy;
  if(project.endoflifePolicy && project.endoflifePolicy.enabled){
    endoflifePolicy = project.endoflifePolicy;
  }
  if(module.endoflifePolicy && module.endoflifePolicy.enabled){
    endoflifePolicy = module.endoflifePolicy;
  }
  if(endoflifePolicy && endoflifePolicy.enabled){
    self.endoflifePolicy = endoflifePolicy
    await self.eachComponent(db, module, project, company, function (comp, component) {
      const versions = compVersions(comp);
      if (!Module.isComponentWhitelisted(module, comp.key, versions)) {
        _.each(versions, function (version) {
          const statusInfo = Component.getEndoflifeStatus(component, endoflifePolicy, version);
          if (statusInfo && (statusInfo.status === 'warnings' || statusInfo.status === 'violations')) {
            let {isEol, eolFrom, isEoas, eoasFrom, status} = statusInfo;
            let texts = [];
            if(isEoas){
              let endDate = eoasFrom ? `end date: ${eoasFrom}`: ''
              texts.push(`Active support ${endDate}`)
            }
            if(isEol){
              let endDate = eolFrom ? `end date ${eolFrom}`: ''
              texts.push(`Security support ${endDate}`)
            }
            self.addComponentError('endoflife', status, texts.join(' and '),
                comp.key, version);
          }
        })
      }
    });
  }
};

Analysis.prototype.encryptionAnalysis = async function (db, module, project, company) {
  const self = this;
  const algorithmsConfig = (project && project.algorithmsConfig || []).concat((company && company.algorithmsConfig || [])).concat((module && module.algorithmsConfig || []));
  self.algorithmsConfig = algorithmsConfig
  await self.eachComponent(db, module, project, company, function (comp, component) {
    const versions = compVersions(comp);
    const algorithmsRaw = ((comp && comp.crypto_algorithms) || (component && component.crypto_algorithms) || [])
    const algorithms = algorithmsRaw.map((item)=>{
      return item.algorithm.toLowerCase()
    })
    if(algorithms && algorithms.length > 0){
      self.components[comp.key].crypto_algorithms = algorithmsRaw
    }
    if(algorithmsConfig && algorithmsConfig.length){
      if (!Module.isComponentWhitelisted(module, comp.key, versions) && algorithms && algorithms.length > 0) {
        processEncryption(self, comp, algorithms, versions, algorithmsConfig)
      }
    }
  });
};

// Carry AI/ML artifact markers onto the analysed component, mirroring crypto_algorithms in
// encryptionAnalysis. Collect + report only (no policy evaluation) so AI artifacts surface
// in the views/reports without an extra lookup.
Analysis.prototype.aiAnalysis = async function (db, module, project, company) {
  const self = this;
  await self.eachComponent(db, module, project, company, function (comp, component) {
    const aiModelsRaw = ((comp && comp.ai_models) || (component && component.ai_models) || [])
    if(aiModelsRaw && aiModelsRaw.length > 0){
      self.components[comp.key].ai_models = aiModelsRaw
    }
  });
};

Analysis.prototype.integrityAnalysis = async function (db, scan, module, project, company) {
  const self = this;

  function checkChecksum(version, dependency) {
    if (version && version.version === dependency.versions[0]) {
      const result = Version.validateChecksum(version, dependency.checksum);
      if (result && result.valid === false) {
        self.addComponentError('integrity', 'violations', 'checksumError', dependency.checksum,
          dependency.key, dependency.versions[0]);
      }
    }
  }

  await self.eachDependency(scan, async function (dependency) {
    const component = await self.getComponent(db, dependency.key, module, null, dependency, project, company);
    if (!component) {
      return;
    }
    if(!Module.isComponentWhitelisted(module, dependency.key, dependency.versions) && dependency.versions){
      _.each(dependency.versions, function (v) {
        const version = _.findWhere(component.versions, {version: v});
        if(version){
          checkChecksum(version, dependency);
        }
      });
    }
  });
};

Analysis.prototype.evaluateLicenses = async function (db, scan, module, project) {
  const self = this;
  return await getModuleComponents(db, self.companyId, module,
    Object.keys(self.components).map(key => self.components[key])).then(async (req) => {
    if (!req.error) {
      let settings;
      if(project && project.requirements){
        settings = _.extend(project.requirements, module.requirements);
      }else{
        settings = module.requirements
      }
      let obligationConfig;
      if(project && project.obligationConfig){
        obligationConfig = _.extend(project.obligationConfig, module.obligationConfig);
      }else{
        obligationConfig = module.obligationConfig
      }
      let legalRulesConfig;
      if(project && project.legalRulesConfig){
        legalRulesConfig = _.extend(project.legalRulesConfig, module.legalRulesConfig);
      }else{
        legalRulesConfig = module.legalRulesConfig
      }
      self.moduleRequirements = settings;
      self.moduleResolvedObligations = obligationConfig;
      self.moduleResolvedRules = legalRulesConfig;
      let rebuildModuleObject = Utils.rebuildModuleObject(module, req, project)
      // One solve per (entry, license) on the check side, and rebuildModuleObject emits an
      // entry per component:version:path - so ask only about the DISTINCT
      // licenses/modified/tightCoupled combinations and spread the answer back below.
      // rebuildModuleObject itself keeps every entry: the loop further down still reads each
      // path's own modified/tightCoupled out of it.
      const deduped = Utils.dedupeCheckComponents(rebuildModuleObject.components);
      const askedCount = Object.keys(deduped.components).length;
      const totalCount = Object.keys(rebuildModuleObject.components || {}).length;
      console.info('=> CheckModule entries: %s distinct of %s', askedCount, totalCount);
      const request = await TSCheck.CheckModule(
        Object.assign({}, rebuildModuleObject, {components: deduped.components}));
      if (request && request.status === 200) {
        if (!request.error && request.data) {
          const notViolatedRules = await Utils.dbFind(db, 'rules', {type: 'warning'}, 200);
          const notViolatedRulesKeys = _.map(notViolatedRules, c => c.key)
          const listComponents = Utils.expandCheckResult(
            request.data && request.data[Object.keys(request.data)[0]], deduped.groups);
          self.components = _.map(self.components, function (component) {
            component.versions = _.map(component.versions, function (version) {
              // eslint-disable-next-line sonarjs/no-nested-functions
              version.paths = _.map(version.paths, function (path, pathIndex) {
                let element = listComponents && listComponents[component.key + ':' + version.version + ':' + pathIndex];
                let settingsData = rebuildModuleObject && rebuildModuleObject.components && rebuildModuleObject.components[component.key + ':' + version.version + ':' + pathIndex];
                if(!element || Object.keys(element).length === 0){
                  self.addComponentError('legal', 'warnings', 'unknown', component.key, version.version, null, true);
                  return {
                    path: path,
                    options: {
                      componentModified: settingsData && settingsData.modified,
                      tightCoupled: settingsData && settingsData.tightCoupled
                    },
                    licenses: [{'key' : 'unknown', 'status' : {'status' : 'warnings','reason' :
                            'Please contact support. Certain aspects of this license are currently under investigation'}}]
                  }
                }
                return {
                  path: path,
                  options: {
                    componentModified: settingsData && settingsData.modified,
                    tightCoupled: settingsData && settingsData.tightCoupled
                  },
                  licenses: _.map(element, function (item, license) {
                    let licenseStatus = Utils.normalizeLicenseStatus(item, component.key, obligationConfig, legalRulesConfig, notViolatedRulesKeys)
                    if(licenseStatus.status !== 'ok' || item.status === 'UNKNOWN'){
                      const errorStatus = item.status === 'UNKNOWN' ? 'warnings' : licenseStatus.status
                      let extra = null;
                      if(isLicenseSelected(module, component.key, '*', null, license)){
                        extra = {
                          selected: true
                        }
                      }
                      self.addComponentError('legal', errorStatus, license, component.key, version.version, extra, true);
                    }
                    return {
                      key: license,
                      rawStatus: item.status,
                      status: licenseStatus
                    }
                  })
                }
              });
              return version
            });
            return component
          });
        }
      }
    }
  });
};

Analysis.prototype.computeStatistics = async function (db, module, project, company) {
  const self = this;
  const statistics = self.statistics;

  function countComponents(components) {
    return _.uniq(components, function (elem) {
      return elem.componentKey
    }).length;
  }

  _.each(self.licenses, function (license) {
    const componentCnt = countComponents(license.components);
    if (license && license.key && componentCnt > 0) {
      statistics.licenses++;
    }
    let statuses = license.components.map(comp =>{
      return comp && comp.status && comp.status.status
    })
    if(statuses.indexOf('violations') > -1){
      license.status = 'violations';
    }else if(statuses.indexOf('warnings') > -1){
      license.status = 'warnings';
    }else{
      license.status = 'ok';
    }
  });

  function isWhitelisted(license,company,project,module) {
    if (!license) return false;
    return Company.isLicenseWhitelisted(company, license.key) || Project.isLicenseWhitelisted(project, license.key)
        || Module.isLicenseWhitelisted(module, license.key)
  }

  function isBlacklisted(license,company,project,module) {
    if (!license) return false;
    return Company.isLicenseBlacklisted(company, license.key) || Project.isLicenseBlacklisted(project, license.key)
        || Module.isLicenseBlacklisted(module, license.key)
  }
  function isLicenseSelected(module, component, version, path, selectedLicense) {
    return module && Module.isLicenseSelected(module, component, version, path, selectedLicense);
  }

  const UNASSIGNED_MODULES = 'Unassigned Modules'
  const WL_COMPANY = 'Allowed in company'
  const BL_COMPANY = 'Denied in company'
  const WL_PROJECT = 'Allowed in project'
  const BL_PROJECT = 'Denied in project'
  const WL_MODULE = 'Allowed in module'
  const BL_MODULE = 'Denied in module'
  function updateComponentStatus(module, project, company, component, vulnConfidence) {
    let vulnerabilityConfidence = vulnConfidence || 4
    let viabilityStatus = 'ok';
    let ossfStatus = 'ok';
    let integrityStatus = 'ok';
    if(component.problems && component.problems.viability) {
      let viabilityStatuses = _.unique(_.map(component.problems.viability, elem =>{
        return elem.status
      }));
      if(viabilityStatuses.indexOf('violations') > -1){
        viabilityStatus = 'violations'
      }else if (viabilityStatuses.indexOf('warnings') > -1){
        viabilityStatus = 'warnings'
      }
    }
    if(component.problems && component.problems.integrity) {
      let integrityStatuses = _.unique(_.map(component.problems.integrity, elem =>{
        return elem.status
      }));
      if(integrityStatuses.indexOf('violations') > -1){
        integrityStatus = 'violations'
      }else if (integrityStatuses.indexOf('warnings') > -1){
        integrityStatus = 'warnings'
      }
    }
    if(component.problems && component.problems.ossf) {
      let ossfStatuses = _.unique(_.map(component.problems.ossf, elem =>{
        return elem.status
      }));
      if(ossfStatuses.indexOf('violations') > -1){
        ossfStatus = 'violations'
      }else if (ossfStatuses.indexOf('warnings') > -1){
        ossfStatus = 'warnings'
      }
    }
    let versioningStatus = 'ok';
    if(component.problems && component.problems.versioning) {
      let versioningStatuses = _.unique(_.map(component.problems.versioning, elem =>{
        return elem.status
      }));
      if(versioningStatuses.indexOf('violations') > -1){
        versioningStatus = 'violations'
      }else if (versioningStatuses.indexOf('warnings') > -1){
        versioningStatus = 'warnings'
      }
    }
    let encryptionStatus = Component.getEncryption(component);
    let endoflifeStatus = Component.getEndoflife(component);
    let vulnStatus = 'ok';
    if(component.problems && component.problems.vulnerability) {
      let vulnStatuses = _.unique(_.map(_.filter(component.problems.vulnerability, elem =>{
        return (elem && elem.extra && !elem.extra.isWhitelisted) && Vulnerability.confidenceMap(elem.extra.confidence) >= vulnerabilityConfidence
      }), elem =>{
        return elem.status
      }));
      if(vulnStatuses.indexOf('violations') > -1){
        vulnStatus = 'violations'
      }else if (vulnStatuses.indexOf('warnings') > -1){
        vulnStatus = 'warnings'
      }
    }
    let licenseStatus = 'ok';
    let multyLicenseStatus = 'ok'
    let total = 'ok';
    let label = 'OK';
    let listed = false;
    let notWhitelistedLicense = false;
    let alterLabel;
    if (!project) {
      project = {name: UNASSIGNED_MODULES, _id: '$unassigned'}
    }
    let requireWhitelist = company && company.requireWhitelist || project.requireWhitelist;

    Component.getVersions(component).forEach(function (version) {
      let multyLicense = false;
      if (version) {
        // evaluateLicenses is what rewrites version.paths from raw path strings into
        // {path, options, licenses} objects. When the legal check is unavailable (CheckModule
        // times out or answers with an error) that rewrite is
        // skipped and paths stay strings, so `.licenses` is undefined. Compact here so the
        // branches below see an empty license list - which they already handle as "warnings" -
        // instead of dereferencing undefined entries.
        let states = _.compact(_.flatten(_.map(version.paths, function (licenseComponent) {
          return licenseComponent && licenseComponent.licenses
        })));
        let uniqueLicenses = _.unique(states, function (licenseComponent) {
          return licenseComponent && licenseComponent.key
        });
        if(uniqueLicenses.length > 1){
          multyLicenseStatus = 'warnings'
          let newLicenses = [];
          let selectedLicense = _.find(uniqueLicenses,function (license) {
            return license && isLicenseSelected(module, component.key, null, null, license.key)
          });
          if(!selectedLicense){
            multyLicense = true;
            states = uniqueLicenses;
          }else{
            newLicenses.push(selectedLicense);
            states = newLicenses
          }
        }
        if(!states || states.length < 1) {
          licenseStatus = 'warnings';
          label = 'Warnings';
        } else if(multyLicense){
          licenseStatus = 'warnings';
          label = 'Warnings';
          multyLicenseStatus = 'violations'
        } else if (_.any(states, function (item) {
          if(item){
            // eslint-disable-next-line sonarjs/no-nested-functions
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
          licenseStatus = 'violations';
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
        if (company && Company.isComponentWhitelisted(company, component.key, version.version)) {
          label = WL_COMPANY;
          total = 'ok';
          listed = true
        } else if (company && Company.isComponentBlacklisted(company, component.key, version.version)) {
          label = BL_COMPANY;
          total = 'violations';
          listed = true
        } else if (project && Project.isComponentWhitelisted(project, component.key, version.version)) {
          label = WL_PROJECT;
          total = 'ok';
          listed = true
        } else if (project && Project.isComponentBlacklisted(project, component.key, version.version)) {
          label = BL_PROJECT;
          total = 'violations';
          listed = true
        } else if (module && Module.isComponentWhitelisted(module, component.key, version.version)) {
          label = WL_MODULE;
          total = 'ok';
          listed = true
        } else if (module && Module.isComponentBlacklisted(module, component.key, version.version)) {
          label = BL_MODULE;
          total = 'violations';
          listed = true
        }else if (module && Module.isComponentChangedStatus(module, component.key, version.version)){
          let changedComponent = Module.isComponentChangedStatus(module, component.key, version.version);
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
      [licenseStatus, vulnStatus, viabilityStatus, ossfStatus, versioningStatus, encryptionStatus, endoflifeStatus].forEach(function (status) {
        if ((total === 'ok' || total === 'warnings') && status === 'violations') {
          total = 'violations';
          label = 'Violations';
        } else if (total === 'ok' && status === 'warnings') {
          total = 'warnings';
          label = 'Warnings';
        }
        if(notWhitelistedLicense){
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
      ossf: ossfStatus,
      integrity: integrityStatus,
      endoflife: endoflifeStatus,
      'multy-legal': multyLicenseStatus
    };
    component.label = alterLabel || label;
    return component;
  }

  await self.eachComponent(db, module, project, company, async function (comp) {
    comp = updateComponentStatus(module, project, company, comp, self.confidenceMinScore)
    if(comp.statuses.vulnerability === 'violations'){
      statistics.vulnerability.violations ++;
    }else if(comp.statuses.vulnerability === 'warnings'){
      statistics.vulnerability.warnings ++;
    }
    if(comp.statuses.legal === 'violations'){
      statistics.legal.violations ++;
    }else if(comp.statuses.legal === 'warnings'){
      statistics.legal.warnings ++;
    }
    if(comp.statuses['multy-legal'] === 'violations'){
      statistics['multy-legal'].violations ++;
    }else if(comp.statuses['multy-legal'] === 'warnings'){
      statistics['multy-legal'].warnings ++;
    }
    if(comp.status === 'violations'){
      statistics.overall.violations ++;
    }else if(comp.status === 'warnings'){
      statistics.overall.warnings ++;
    }
  });
};

Analysis.prototype.adjustMultiLicenseComponents = async function (db, module, project, company) {
  const self = this;

  function getRating(license) {
    return license && license.rating && license.rating.totalRating || 0;
  }

  await self.eachComponent(db, module, project, company, async function (comp, component) {
    _.each(compVersions(comp), function (version) {
      const compVersion = Component.findVersion(component, version);
      const compLicenses = compVersion ?  Version.getLicenses(compVersion, component.declaredLicenses, module, component.key) : [];
      if (compLicenses.length > 1) {
        let bestLicense;
        let hasCommercial = false;
        _.each(compLicenses, function (compLicense) {
          const compLicenseKey = compLicense.key;
          if (compLicenseKey) {
            const license = self.licenses[compLicenseKey];
            if (getRating(license) > getRating(bestLicense)) {
              bestLicense = license;
            }
          }
          if (compLicenseKey === 'COMMERCIAL') {
            hasCommercial = true;
          }
        });
        if (hasCommercial === false && bestLicense && bestLicense.rating && bestLicense.rating.totalRating) {
          _.each(compLicenses, function (compLicense) {
            const license = self.licenses[compLicense.key];
            if (license && (license.key !== bestLicense.key)) {
              const compKey = component.key + ':' + version;
              license.components = _.without(license.components, compKey);
            }
          });
        }
      }
    });
  });
};

Analysis.prototype.evaluateCapabilities = async function (db) {
  const self = this;
  const capabilities = await Utils.dbFind(db, 'capabilities', {moduleId: self.moduleId, companyId: self.companyId}, 1000 );
  await _.each(capabilities, async res => {
    let {name, version, description} = res
    self.capabilities.push({name, version, description})
  })
  return capabilities
};

Analysis.prototype.createResult = function (scanId, tag, release, branch, binaryLinks, linkedModules, linkedReleases, demo) {

  let countRoot = 0;

  function reorganizeComponents(components) {
    let sortedComponents = _.sortBy(components, function (value, key) {
      return key;
    });
    sortedComponents = _.sortBy(sortedComponents, function (value) {
      if(value.root){
        countRoot += 1
      }
      return value.root;
    });
    const newComponents = [];

    _.each(sortedComponents, function (value) {
      newComponents.push(value);
    });

    return newComponents;
  }

  function reorganizeLicense(licenses) {
    const newLic = [];

    _.each(licenses, function (value) {
      if (value.components && value.components.length > 0) {
        value.components = _.uniq(value.components, function (comp){
          return comp.path + comp.componentKey + comp.version
        })
        newLic.push(value);
      }
    });

    return _.sortBy(newLic, 'name');
  }
  return {
    _id: uuidv4(),
    date: new Date(),
    scanId: scanId,
    companyId: this.companyId,
    moduleId: this.moduleId,
    components: reorganizeComponents(this.components),
    licenses: reorganizeLicense(this.licenses),
    statistics: this.statistics,
    moduleRequirements: this.moduleRequirements,
    ciaRequirements: this.ciaRequirements,
    viabilityConfig: this.viabilityConfig,
    ossfConfig: this.ossfConfig,
    versioningConfig: this.versioningConfig,
    endoflifePolicy: this.endoflifePolicy,
    algorithmsConfig: this.algorithmsConfig,
    environmentalConfig: this.environmentalConfig,
    confidenceMinScore: this.confidenceMinScore,
    capabilities: this.capabilities,
    release: release,
    tag: tag,
    binaryLinks: binaryLinks,
    linkedModules: linkedModules || null,
    linkedReleases: linkedReleases || null,
    branch: branch,
    demo: demo || this.demo,
    rootComponentsCount: countRoot,
    latest: true
  }
};

const ModuleAnalyzer = function (db, company, project, module, scan, user, analysis, demo) {
  this.user = user;
  this.companyId = company._id;
  this.projectId = project._id;
  this.moduleId = module._id;
  this.scanId = scan && scan._id;
  this.company = company;
  this.project = project;
  this.module = module;
  this.scan = scan;
  this.lastAnalysis = analysis;
  this.demo = demo;
  this.db = db;
};

ModuleAnalyzer.prototype.analyze = async function analyze() {
  let self = this;
  await self.updateStatus('Analysis in progress ...');
  let analysis;
  try {
    analysis = await self.analyzeModule();
  }catch (err) {
    console.log(ERROR_LOG, err);
    analysis = {
      error: err
    }
  }
  if(analysis !== null && !analysis.error){
    await self.saveResult(analysis);
  }else if (analysis && analysis.error){
    await LogEvent(self.db, self.company, self.user, 'Module analysis error for '+self.module.name + ' : '+ analysis.error, 'moduleAnalyzeProcessing');
    await self.updateStatus(FINISHED);
  }else{
    await self.updateStatus(FINISHED);
  }
  return ((analysis && !analysis.error)||!analysis)? analysis : analysis.error
};

ModuleAnalyzer.prototype.updateStatus = async function updateStatus(newStatus) {
  await this.updateModule({
    $set: {status: newStatus}
  });
};

ModuleAnalyzer.prototype.updateAnalyzed = async function updateAnalyzed(date) {
  await this.updateModule({
    $set: {analyzed: date}
  });
};

ModuleAnalyzer.prototype.updateModule = async function updateModule(modifier) {
  await this.db.collection('modules').updateOne({_id: this.moduleId}, modifier);
};

ModuleAnalyzer.prototype.saveResult = async function saveResult(analysis) {
  let self = this;
  let changeSet = {
    $set: {
      status: FINISHED,
      analysisRequired: false,
      analyzed: new Date()
    }
  };
  analysis.result = {};
  if (analysis) {
    let tag = this.scan && this.scan.tag || null;
    let release = this.scan && this.scan.release || null;
    let branch = this.scan && this.scan.branch || null;
    let scanId = this.scan && this.scan._id || null;
    let binaryLinks = this.scan && this.scan.binaryLinks || null;
    let linkedModules = this.module && this.module.linkedModules || null;
    let linkedReleases = this.module && this.module.linkedReleases || null;
    analysis.result = await analysis.createResult(scanId, tag, release, branch, binaryLinks, linkedModules, linkedReleases, this.demo);
  }
  logDuration( self.logData,'saveResult')
  return await self.db.collection('analysis').insertOne(analysis.result)
  .then(async (res) => {
    try {
      logDuration( self.logData,'saveResult')
      let statistics = analysis.result.statistics;
      statistics.analysisId = res.insertedId;
      changeSet.$set.statistics = statistics;
      logDuration( self.logData,'updateLatestFlag')
      await self.updateLatestFlag(res.insertedId);
      logDuration( self.logData,'updateLatestFlag')
      logDuration( self.logData,'updateModuleStats')
      await self.updateModule(changeSet);
      logDuration( self.logData,'updateModuleStats')
      logDuration( self.logData,'computeAndUpdateCompanyStats')
      await self.updateCompanyStatistics();
      logDuration( self.logData,'computeAndUpdateCompanyStats')
      logDuration( self.logData,'saveLogs')
      await LogEvent(self.db, self.company, self.user, 'Module analysis processed for '+self.module.name, 'moduleAnalyzeProcessing');
      logDuration( self.logData,'saveLogs')
      // Add action notifyAboutAnalysis
      // Meteor.call('notifyAboutAnalysis', self.module._id, self.module.companyId, data);
    }catch (e) {
      console.log(ERROR_LOG, e);
      await self.updateStatus(FINISHED);
    }
  })
  .catch(err => {
    console.log(ERROR_LOG, err);
    self.updateStatus(FINISHED);
  });
};


ModuleAnalyzer.prototype.analyzeModule = async function analyzeModule() {
  let self = this;
  const module = self.module;
  const project = self.project;
  const scan = self.scan;
  const company = self.company;
  self.logData = {}
  if (!scan && (!module.customComponents || module.customComponents.length < 1) ) {
    await this.updateAnalyzed(new Date());
    return null;
  } else {
    const requireWhitelist = company.requireWhitelist || project.requireWhitelist;
    const analysis = new Analysis(module.companyId, module._id, this.demo || module.demo, this.lastAnalysis);
    logDuration( self.logData,'gatherComponents')
    await analysis.gatherComponents(this.db, scan, module, project, company);
    logDuration( self.logData,'gatherComponents')
    logDuration( self.logData,'integrityAnalysis')
    await analysis.integrityAnalysis(this.db, scan, module, project, company);
    logDuration( self.logData,'integrityAnalysis')
    logDuration( self.logData,'viabilityAnalysis')
    await analysis.viabilityAnalysis(this.db, module, project, company);
    logDuration( self.logData,'viabilityAnalysis')
    logDuration( self.logData,'ossfAnalysis')
    await analysis.ossfAnalysis(this.db, module, project, company);
    logDuration( self.logData,'ossfAnalysis')
    logDuration( self.logData,'ciaAnalysis')
    await analysis.ciaAnalysis(this.db, module, project, company);
    logDuration( self.logData,'ciaAnalysis')
    logDuration( self.logData,'versioningAnalysis')
    await analysis.versioningAnalysis(this.db, module, project, company);
    logDuration( self.logData,'versioningAnalysis')
    logDuration( self.logData,'encryptionAnalysis')
    await analysis.encryptionAnalysis(this.db, module, project, company);
    logDuration( self.logData,'encryptionAnalysis')
    logDuration( self.logData,'aiAnalysis')
    await analysis.aiAnalysis(this.db, module, project, company);
    logDuration( self.logData,'aiAnalysis')
    logDuration( self.logData,'endoflifeAnalysis')
    await analysis.endoflifeAnalysis(this.db, module, project, company);
    logDuration( self.logData,'endoflifeAnalysis')
    logDuration( self.logData,'osvSync')
    await analysis.osvSync(this.db, module);
    logDuration( self.logData,'osvSync')
    logDuration( self.logData,'vulnerabilityAnalysis')
    await analysis.vulnerabilityAnalysis(this.db, module, project, company);
    logDuration( self.logData,'vulnerabilityAnalysis')
    logDuration( self.logData,'evaluateLicenses')
    await analysis.evaluateLicenses(this.db, scan, module, project);
    logDuration( self.logData,'evaluateLicenses')
    logDuration( self.logData,'legalAnalysis')
    await analysis.legalAnalysis(this.db, scan, module, requireWhitelist, project, company);
    logDuration( self.logData,'legalAnalysis')
    logDuration( self.logData,'adjustMultiLicenseComponents')
    await analysis.adjustMultiLicenseComponents(this.db, module, project, company);
    logDuration( self.logData,'adjustMultiLicenseComponents')
    logDuration( self.logData,'evaluateCapabilities')
    await analysis.evaluateCapabilities(this.db, module);
    logDuration( self.logData,'evaluateCapabilities')
    logDuration( self.logData,'computeStatistics')
    await analysis.computeStatistics(this.db, module, project, company);
    logDuration( self.logData,'computeStatistics')
    return analysis;
  }
};

const computeStatistics = async function (db, currentDate, companyId) {
  const companyStats = {
    date: currentDate,
    modules: {
      warnings: 0,
      violations: 0,
      total: 0
    },
    components: {
      warnings: 0,
      violations: 0,
      total: 0
    },
    licenses: {
      warnings: 0,
      violations: 0,
      total: 0
    }
  };
  if(companyId !== 'COMPANY_ID'){
    await Utils.dbFind(db,'modules',{companyId}, 1000, null, {projection: {statistics: 1}})
    .then( async res => {
      await _.each(res, async moduleRaw => {
        const moduleStats = await Module.getStatistics(db, moduleRaw);
        if (moduleStats) {
          switch (Statistics.getState(moduleStats)) {
            case 'warnings':
              companyStats.modules.warnings++;
              break;
            case 'violations':
              companyStats.modules.violations++;
              break;
          }
          companyStats.modules.total++;
          _.each(['legal', 'vulnerability', 'viability', 'integrity', 'versioning', 'encryption', 'overall'
            , 'ossf'], key => {
            if(moduleStats[key]){
              companyStats.components.warnings += moduleStats[key].warnings;
              companyStats.components.violations += moduleStats[key].violations;
            }
          });
          companyStats.components.total += moduleStats.components;
          companyStats.licenses.total += moduleStats.licenses;
        }
      });
    })
    .catch(err => {
      console.log(ERROR_LOG, err);
    });
  }
  return companyStats;
};

ModuleAnalyzer.prototype.updateCompanyStatistics = async function (date) {
  const self = this;

  const currentDate = date || new Date();

  const companyStats = await computeStatistics(self.db, currentDate, self.companyId);

  const startDate = moment(currentDate).set('hour', 0).set('minute', 0).set('second', 0).set('millisecond', 0);
  const endDate = startDate.clone().add(1, 'days');

  const currentDateQuery = {
    _id: self.companyId
  };

  let currentDateExists = false;
  let company = self.company;

  if (_.some(company.statistics, function (statistic) {
    return statistic.date > startDate.toDate() && statistic.date < endDate.toDate()
  })) {
    currentDateExists = true;
    currentDateQuery['statistics.date'] = {$gte: startDate.toDate(), $lt: endDate.toDate()};
  }

  if (currentDateExists) {
    await self.db.collection('companies').updateOne(currentDateQuery, {$set: {'statistics.$': companyStats}});
  } else {
    await self.db.collection('companies').updateOne(currentDateQuery, {$push: {'statistics': { $each:[companyStats], $slice: -100 }}});
  }
};

ModuleAnalyzer.prototype.updateLatestFlag = async function (newId) {
  const self = this;

  const currentQuery = {
    companyId: self.companyId,
    moduleId: self.moduleId,
    latest: true,
    _id: { $not: { $in:[newId] } }
  };

  await self.db.collection('analysis').updateMany(currentQuery, {$set: {'latest': false}});
};

export { ModuleAnalyzer, Analysis, mergeWorkingSetLicenses, componentPick,
  declaredScanLicenses, applyComponentPick };

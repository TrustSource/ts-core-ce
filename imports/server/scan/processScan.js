import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import {Roles} from 'meteor/alanning:roles';
import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Component from '/imports/lib/component/Component';
import Scans from '/imports/lib/collections/scans';
import Companies from '/imports/lib/collections/companies';
import Modules from '/imports/lib/collections/modules';
import Licenses from '/imports/lib/collections/licenses';
import Utils from '/imports/server/ServerUtils';
import QOS from '/imports/lib/component/QOS';
import {matchLicense, matchWellknownLicenseName, cleanupLicenseName} from '/imports/server/scan/licenseMatch';
import {PackageURL} from 'packageurl-js';
import {keyFromParsedPurl, splitComponentKey, clearSpdxKey as sharedClearSpdxKey} from '/imports/lib/component/keyFromPurl';
import {findRootDependency, rootPickLicense, isRootPickLicense, withoutRootPickLicenses,
  stripInjectedRootLicenses} from '/imports/server/scan/rootDependency';
import {injectableLicenseMap, resolvedLicenseKeys,
  injectResolvedLicenses} from '/imports/server/scan/componentLicensePick';
import {createSkipCollector, SKIP_NO_IDENTIFIER,
  SKIP_PROCESSING_FAILED} from '/imports/server/scan/skippedDependencies';
import {asString} from '/imports/lib/security/sanitizeQuery';
import {isStorableChecksum} from '/imports/lib/component/checksumFormat';

const LOG_USER = 'ScanProcessor';

// Payload text interpolated into a log line lets the payload write log lines. A dependency
// `key` or `name` is a schema String with no character restriction, so a `\n` in one splits
// the entry and the rest of it reads as a line this process never wrote. JSON.stringify
// quotes the value and escapes CR/LF, which is all that is needed and keeps the value
// readable. Applied to every caller-supplied fragment the scan path logs, including the
// driver messages, because an E11000 quotes the offending document back.
function logSafe(value) {
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(typeof value === 'string' ? value : String(value));
}

async function checkIfManager() {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user, ['manager', 'compliance_manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return user;
}

function getPackageUrl(componentKey, version) {
  const result = new Utils.ComponentKey(componentKey, { mgr: true, component: true });
  if (result && result.component && result.manager !== 'im') {
    const split = splitComponentKey(`${result.manager}:${result.component}`);
    let org = split ? split.namespace : null;
    let key = split ? split.name : result.component;
    // For maven, if no ":" separator was found, try splitting by first "-"
    // e.g. "com.fasterxml.jackson.core-jackson-databind" -> org="com.fasterxml.jackson.core", key="jackson-databind"
    if (!org && result.manager === 'maven' && key.indexOf('-') > 0) {
      const dashIdx = key.indexOf('-');
      org = key.substring(0, dashIdx);
      key = key.substring(dashIdx + 1);
    }
    if (key) {
      try {
        const purl = new PackageURL(result.manager, org, key, version)
        return purl.toString()
      } catch (e) {
        console.warn(`getPackageUrl failed for "${componentKey}" (${result.manager}/${org}/${key}@${version}): ${e.message}`);
        return null;
      }
    }
    return null;
  }
  return null;
}

// An unparseable purl means "this node has no purl", not "this run is over". The node may
// still carry a usable `key`; if it does not, the no-identifier guard below records it.
function parsePurl(purl) {
  if (!purl) return null;
  try {
    return PackageURL.fromString(purl);
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) {
    return null;   // the malformed value is reported to the client by the API schema
  }
}

// The catalogue document for one scanned key.
//
// Look up first, write only on a miss. The old code ran an unconditional upsert - a WRITE
// per dependency, for the overwhelming majority of nodes that already exist - and then a
// find anyway: roughly 1832 round trips for the production p95 tree of 916 nodes. The
// unique index on `key` still provides the atomicity the upsert was added for; it is what
// makes two concurrent scans of a brand-new key end up with one document.
//
// The `key` and `oldKey` lookups are two ordered point queries rather than one `$or`. With
// the `$or`, a key that exists as `key` on one document and as `oldKey` on another resolved
// to whichever document Mongo yielded first - and the unconditional upsert running ahead of
// it is what created that second document in the first place. Both are index-served
// (key_1_unique, oldKey_1).
async function resolveCatalogueComponent(lowerKey, name) {
  let component = await Components.findOneAsync({key: lowerKey});
  if (component) return component;
  component = await Components.findOneAsync({oldKey: lowerKey});
  if (component) return component;
  try {
    await Components.upsertAsync(
      {key: lowerKey},
      {$setOnInsert: {
        key: lowerKey,
        name: name,
        created: new Date(),
        createdBy: 'ScanProcessor'
      }}
    );
  } catch (error) {
    // A concurrent run inserted the same key between the find above and this upsert. The
    // unique index is what makes that safe, and the re-read below is what makes it
    // invisible - but the rejection has to be caught, or it takes the process down.
    console.log('=> processScan: insert-if-missing lost a race for', logSafe(lowerKey), '-',
      logSafe((error && error.message) || error));
  }
  return Components.findOneAsync({key: lowerKey});
}

// The node's own work: identifier derivation, the component lookup, and the ref written
// back onto the dependency. Split out from handleDependency so exactly this much can be
// wrapped in a try/catch while the walk into the node's children stays outside it.
//
// Returns the key the child walk should use as its path segment, or undefined when the
// node carried nothing to identify a component by.
async function processDependencyNode(dependency, parentPath, ctx) {
  const {user, privateLicenses} = ctx;
  let component;
  if(dependency.key && dependency.key.indexOf('mvn') === 0){
    dependency.key = 'maven' + dependency.key.slice(3)
  }
  if(dependency.purl && dependency.purl.indexOf('pkg:mvn') === 0){
    dependency.purl = 'pkg:maven' + dependency.purl.slice(7)
  }
  if(dependency.key && dependency.key.indexOf('pip') === 0){
    dependency.key = 'pypi' + dependency.key.slice(3)
  }
  if(dependency.purl && dependency.purl.indexOf('pkg:pip') === 0){
    dependency.purl = 'pkg:pypi' + dependency.purl.slice(7)
  }
  let key = dependency.key;
  let versions = dependency.versions;
  let pkg = parsePurl(dependency.purl);
  if(!key && pkg){
    key = keyFromParsedPurl(pkg) || dependency.purl
    dependency.key = key
  }
  if(!versions && pkg){
    versions = pkg.version ? [pkg.version] : null
    dependency.versions = versions
  }
  if(!pkg && key){
    let newPkg = getPackageUrl(key, versions && versions[0]);
    if(newPkg){
      dependency.purl = newPkg
    }
  }

  if (typeof key !== 'string' || !key) {
    // Neither a `key` nor a purl anything could be derived from. `key.toLowerCase()` below
    // used to throw here and end the whole run - one node with no identifier cost every
    // valid sibling its component, the scan its dependencyCount, and the module its
    // analysis. Record it and return: the caller still walks this node's children, which
    // are components in their own right.
    ctx.skipped.record(dependency, parentPath, SKIP_NO_IDENTIFIER);
    dependency.parentPath = parentPath;
    return undefined;
  }

  if(key.indexOf('im:') === 0){
    component = await InfrastructureComponents.findOneAsync({key: key.toLowerCase()});
    if(!component){
      component = await COTSComponents.findOneAsync({key: key.toLowerCase()});
    }
  }else{
    const lowerKey = key.toLowerCase();
    component = await resolveCatalogueComponent(lowerKey, dependency.name);
  }
  let id;
  if (component) {
    id = updateComponentFromDependency(component, dependency, user, privateLicenses);
  } else {
    id = createComponentFromDependency(dependency, user, privateLicenses);
  }
  if (id) {
    const { _id } = id
    dependency.component = {_id};
  }
  dependency.parentPath = parentPath
  return key;
}

async function handleDependency(dependency, parentPath, ctx) {
  const {skipped} = ctx;
  let key;
  // Only the node's OWN work is isolated here. One dependency this run cannot store must
  // cost that dependency and nothing else - not its siblings, not the rest of the tree,
  // and not the dependencyCount / root license / analysis that follow the walk.
  try {
    key = await processDependencyNode(dependency, parentPath, ctx);
  } catch (error) {
    console.log('=> processScan: dependency skipped at', logSafe(parentPath),
      logSafe((dependency && dependency.name) || ''), '-',
      logSafe((error && error.message) || error));
    skipped.record(dependency, parentPath, SKIP_PROCESSING_FAILED, error);
    if (dependency) { dependency.parentPath = parentPath; }
  }
  if (!dependency) { return; }
  // Outside the try on purpose: the children of a node that could not be identified or
  // stored are real components of their own, and they are what the scan is mostly made of.
  if (dependency.dependencies) {
    const segment = encodeURIComponent(key || dependency.name || 'unknown');
    for (const child of dependency.dependencies) {
      await handleDependency(child, `${parentPath}${segment}/`, ctx);
    }
  }
}

function clearSpdxKey(key){
  return sharedClearSpdxKey(key).toLowerCase()
}
function cleanLicenseName(name){
  return cleanupLicenseName(name.trim())
}
function multyLicenseNameToList(name){
  let result = []
  let parts = name.split('OR')
  _.each(parts, function (license) {
    if (license && license.length) {
      let newName = cleanLicenseName(license)
      if(newName.indexOf('AND') > -1){
        let subLicense = {name:newName, scannedLicense: newName}
        resolveAndCase(result, subLicense)
      }else{
        result.push({name:newName});
      }
    }
  });
  return result
}

function resolveAndCase(result, license){
  let parts = license.name.split('AND')
  let subList = []
  _.each(parts, function (partLicense) {
    let newAndName = cleanLicenseName(partLicense)
    if(newAndName && subList.length === 0){
      license.scannedLicense = license.name
      license.name = newAndName
      subList.push(license)
    }
  });
  if(subList && subList[0]){
    result.push(subList[0]);
  }
}

export const preProcessLicenses = function preProcessLicenses(list){
  let result = []
  // iterate over list
  _.each(list, function (license) {
    if(license && license.name && (!license.kind || (license.kind && license.kind === 'declared'))) {
      if(license.name.indexOf('OR') > -1){
        let licenseKeys = multyLicenseNameToList(license.name)
        if(licenseKeys.length){
          _.each(licenseKeys, function (one) {
            result.push(one);
          })
        }
      }else if(license.name.indexOf('AND') > -1){
        resolveAndCase(result, license)
      }else {
        license.name = cleanLicenseName(license.name)
        result.push(license);
      }
    }
  });
  if(!result.length && list.length){
    result.push(list[0])
  }
  return result
}
// Component.setUrl marks the document changed whenever it has no url of that type yet -
// INCLUDING when the incoming url is undefined, in which case it creates `urls = {}`, runs
// a no-op delete and sets the flag. updateComponentFromDependency calls it four times per
// node, so with hasChanged() deciding the write (item F) that alone would have written on
// essentially every existing component. Guarded here rather than in the setter: setUrl is
// shared with about twenty client-side edit pages that call store() on their own schedule.
//
// One intended consequence: a component that had no `urls` and whose node carries no url no
// longer gets an empty `urls: {}` written onto it.
function setUrlIfPresent(component, type, url) {
  if (url) {
    component.setUrl(type, url);
  }
}

// The multi-key expansion of a well-known license name (e.g. "CDDL+GPL License" ->
// CDDL-1.1 + GPL-2.0), computed ONCE per dependency into a list of our own.
//
// It used to run inside the per-version loop, pushing onto `tempList` while iterating it -
// and `tempList` was the SAME array object as dependency.licenses, because
// withoutRootPickLicenses returns its input when there is nothing to strip. So every
// expanded key was appended to the scan document that then got stored, and the second
// version re-expanded whatever the first version had appended. Elements appended during a
// forEach are never visited either, so the expansion only ever went one level deep.
//
// The in-place rename of the payload entry stays: that is today's normalisation, it is what
// the stored scan shows, and doing it once (rather than once per version) is why the
// expansion has to be hoisted out of the loop instead of merely copied inside it.
function expandScanLicenses(scanLicenses) {
  const expanded = [];
  (scanLicenses instanceof Array ? scanLicenses : []).forEach(function (license) {
    if (!license) return;
    expanded.push(license);
    if (!license.name) return;
    const matched = matchWellknownLicenseName(license.name);
    if (!(matched instanceof Array) || !matched.length) return;
    const keys = matched.slice();
    license.name = keys.shift();
    keys.forEach(function (key) {
      expanded.push({name: key});
    });
  });
  return expanded;
}

function createComponentFromDependency(dependency, user, privateLicenses) {
  console.log('component not found: ', logSafe(dependency.name), 'key:', logSafe(dependency.key));
  const component = new Component({
    key: clearSpdxKey(dependency.key),
    name: dependency.name,
    provider: dependency.provider
  });

  setUrlIfPresent(component, 'repository', dependency.repoUrl);
  setUrlIfPresent(component, 'homepage', dependency.homepageUrl);
  setUrlIfPresent(component, 'mailing', dependency.mailingUrl);
  setUrlIfPresent(component, 'issues', dependency.issuesUrl);
  component.setDescription(dependency.description);
  if(dependency.crypto_algorithms){
    component.setField('crypto_algorithms', dependency.crypto_algorithms);
  }
  if(dependency.ai_models){
    component.setField('ai_models', dependency.ai_models);
  }

  // `components` is a catalogue shared by every tenant, so the per-company root
  // license this app injects into the scan (see applyRootLicense) must never be
  // written onto a component document.
  const scanLicenses = expandScanLicenses(withoutRootPickLicenses(dependency.licenses));

  (dependency.versions || []).forEach(function (version) {
    const newVersion = component.getVersion(version);
    // The catalogue is shared by every tenant, so the format check belongs HERE and not only
    // at the REST boundary: /reprocess re-runs this over a stored scan without revalidating
    // it, and a scan submitted before 3.2.69 can still be carrying a value the schema would
    // refuse today. Same constant the schema uses.
    if (isStorableChecksum(dependency.checksum)) {
      const checksum = newVersion.getChecksum('dontCare');
      checksum.setChecksum(dependency.checksum);
      checksum.setQos(QOS.PACKAGE_META);
    }

    if (dependency.meta && dependency.meta.versions && dependency.meta.versions.length) {
      const versionMeta = dependency.meta.versions.find((item) => {
        return item.version === version
      });
      if (versionMeta && versionMeta.pkg) {
        newVersion.setPackageUrl(versionMeta.pkg)
      }
    }

    if (scanLicenses instanceof Array) {
      scanLicenses.forEach(function (lic) {
        const mappedLicense = mapLicenseFromScanLicense(lic, privateLicenses);
        let newLicense;

        if (mappedLicense.key) {
          newLicense = newVersion.getLicense(mappedLicense.key);
        } else if (mappedLicense.name) {
          newLicense = newVersion.getLicenseByName(mappedLicense.name);
        }
        if (newLicense && typeof newLicense.setKey === 'function') {
          newLicense.setKey(mappedLicense.key);
          newLicense.setName(mappedLicense.name);
          newLicense.setUrl(mappedLicense.url);
          newLicense.setQos(QOS.PACKAGE_META);
        }
        component.addLog(LOG_USER, version, mappedLicense.message);
      });
    }
  });
  component.store(LOG_USER,null,user);
  return component
}

function updateComponentFromDependency(component, dependency, user, privateLicenses) {
  //console.log('found component, check if update necessary', component.getName());
  dependency.key = component.getKey();
  setUrlIfPresent(component, 'repository', dependency.repoUrl);
  setUrlIfPresent(component, 'homepage', dependency.homepageUrl);
  setUrlIfPresent(component, 'mailing', dependency.mailingUrl);
  setUrlIfPresent(component, 'issues', dependency.issuesUrl);
  component.setDescription(dependency.description);
  if(dependency.crypto_algorithms){
    let currentList = component.getAlgorithms() || [];
    let newList = _.unique([].concat(dependency.crypto_algorithms).concat(currentList), (a)=>{
      return a.algorithm + a.strength
    })
    // setField marks the document changed whatever it is handed, so re-writing an
    // identical merge would bump `updated` on a shared catalogue document every run.
    if (!_.isEqual(newList, currentList)) {
      component.setField('crypto_algorithms', newList);
    }
  }
  if(dependency.ai_models){
    let currentAiList = component.getAiModels() || [];
    let newAiList = _.unique([].concat(dependency.ai_models).concat(currentAiList), (a)=>{
      return (a.purl || a.name || '') + (a.version || '')
    })
    if (!_.isEqual(newAiList, currentAiList)) {
      component.setField('ai_models', newAiList);
    }
  }
  // See createComponentFromDependency: the injected root license is a per-company
  // pick and this document is shared by every tenant. This is the path the leak
  // actually took - the component already exists by the time a scan is re-processed.
  const scanLicenses = withoutRootPickLicenses(dependency.licenses);
  (dependency.versions || []).forEach(function (depVer) {
    const version = component.getVersion(depVer);

    // See createComponentFromDependency: same guard, same reason - this is the branch a
    // re-processed pre-3.2.69 scan actually takes, because the component already exists.
    if (isStorableChecksum(dependency.checksum) && !version.findChecksum(dependency.checksum)) {
      //console.log('Component-Version %s-%s: no valid Checksum found, updating... ', component.getName(), depVer);
      const checksum = version.getChecksum(dependency.checksum);
      checksum.setQos(QOS.PACKAGE_META);
    }

    if (dependency.meta && dependency.meta.versions && dependency.meta.versions.length) {
      const versionMeta = dependency.meta.versions.find((item) => {
        return item.version === depVer
      });
      if (versionMeta && versionMeta.pkg) {
        version.setPackageUrl(versionMeta.pkg)
      }
    }
    // This will allow to update license in db if available
    // version.hasValidatedLicense() !== true &&
    if (scanLicenses && scanLicenses.length > 0) {
      //console.log('Component-Version %s-%s: no valid License found, updating... ', component.getName(), depVer);
      scanLicenses.forEach(function (lic) {
        const mappedLicense = mapLicenseFromScanLicense(lic, privateLicenses);
        let compLicense;

        if (mappedLicense.key) {
          //console.log('Found license by key ', component.getName(), mappedLicense.key);
          compLicense = version.getLicense(mappedLicense.key);
        } else if (mappedLicense.name) {
          //console.log('Found license by name' + component.getName(), mappedLicense.name);
          compLicense = version.getLicenseByName(mappedLicense.name);
        }
        //console.log('Found license qos' + component.getName(), compLicense.getQosStr());
        if (compLicense && compLicense.getQos() === QOS.NOT_CHECKED) {
          //console.log('Updating License' + component.getName(), mappedLicense.name);
          compLicense.setKey(mappedLicense.key);
          compLicense.setName(mappedLicense.name);
          compLicense.setUrl(mappedLicense.url);
          compLicense.setQos(QOS.PACKAGE_META);
          component.addLog(LOG_USER, depVer, mappedLicense.message);
        }
      });
    }
  });
  // The Component class already tracks exactly this: every setter sets `_changed`. The
  // old test serialised the whole document before and after and compared the strings -
  // twice per dependency node, on documents that accumulate versions, licenses and
  // checksums for every tenant, so a popular component paid for two full serialisations
  // per node of every scan that mentions it.
  if (component.hasChanged()) {
    component.store(LOG_USER);
  }
  return component
}

function mapLicenseFromScanLicense(license, privateLicenses) {
  const l = {}, comments = [];

  // Defence in depth for the shared `components` catalogue: every write path funnels
  // through here, so an injected root pick is refused even if a future caller forgets
  // to filter it out. Returning no key and no name leaves the caller nothing to store.
  if (isRootPickLicense(license)) {
    l.message = 'injected root component license, not applied to the shared component';
    return l;
  }

  if (license && license.name) {
    const matchResult = matchLicense(license.name, privateLicenses);
    if (matchResult.matchKey) {
      if (matchResult.ambiguousKey) {
        l.name = license.name;
        comments.push(Utils.format('{0}: ambiguous match found, name copied from scan result = '
          + JSON.stringify(matchResult), l.name));
      } else {
        l.key = matchResult.matchKey;
        l.name = matchResult.matchName;
        comments.push(Utils.format('{0}: key and name matched, score: ' +
          (Math.round(matchResult.score * 100) / 100), license.name));
      }
    } else {
      l.name = license.name;
      comments.push(Utils.format('{0}: no match found, name copied from scan', license.name));
    }
  }
  if (license && license.url) {
    l.url = license.url;
    comments.push(Utils.format('{0}: url copied from scan', license.url));
  }
  l.message = comments.join(', ');
  return l;
}

// Picks the scan's root component dependency. Lives in ./rootDependency so it can
// be unit tested without Meteor; re-exported here for existing importers.
export {findRootDependency};

// How many applied component keys the audit entry below names before it counts
// the rest. Enough to read a whole ordinary module's resolutions, short enough
// that a pathological one cannot turn a log line into a document.
const LOGGED_APPLIED_KEYS = 20;

// Applies the licenses a compliance manager set manually to every
// matching node of the scan's dependency tree, so the deployed analyzer reads
// them like any other declared license.
//
// A thin wrapper: the walk itself is pure and lives in ./componentLicensePick,
// which is where the "keep the scanner's declaration, do not accumulate markers,
// never touch the root" rules are tested. All this adds is the module re-read,
// one query for the display names, and the audit entry.
//
// The ROOT node is skipped on purpose - applyRootLicense owns it from the same
// storage slot and runs immediately after this, producing the same license
// marked ts-root-pick. Mutates `scan` in place; the caller persists it.
export async function applyResolvedLicenses(scan, module, company, user) {
  if (!scan || !module) return;
  const fresh = await Modules.findOneAsync(module._id,
    {fields: {'componentConfig.licensesSelected': 1}});
  // Names first, in ONE query over the distinct keys, so the walk stays free of
  // the database: a display name is cosmetic, but ts-analysis reads
  // `license.key || license.name` and an entry with a bare key reads worse
  // everywhere the scan is rendered.
  const keys = resolvedLicenseKeys(fresh);
  // The overwhelmingly common case - a module with no manual resolutions at all -
  // costs one projection and nothing else.
  if (!keys.length) return;
  // Null-prototype: a license key comes out of the catalogue and could spell
  // `__proto__` or `constructor`.
  const nameByKey = Object.create(null);
  // WHICH keys resolved, kept apart from what they are called. A catalogue entry
  // with no `name` still exists, and existence is what decides whether a key may
  // be injected at all; the display name is cosmetic. The set is the ONLY thing
  // standing between an entry written by a path with no role check
  // (updateCollection, the REST module POST) and the analyzer.
  const knownKeys = new Set();
  const known = await Licenses.find({key: {$in: keys}}, {fields: {key: 1, name: 1}}).fetchAsync();
  known.forEach(function (license) {
    if (license && typeof license.key === 'string' && license.key) {
      knownKeys.add(license.key);
      if (license.name) {
        nameByKey[license.key] = license.name;
      }
    }
  });
  // A company-private key is not in the catalogue, so its own name is used.
  ((company && company.privateLicenses) || []).forEach(function (license) {
    if (license && typeof license.key === 'string' && license.key) {
      knownKeys.add(license.key);
      if (license.name && !nameByKey[license.key]) {
        nameByKey[license.key] = license.name;
      }
    }
  });

  const map = injectableLicenseMap(fresh, nameByKey, knownKeys);
  const rootKey = (findRootDependency(scan) || {}).key;
  const applied = injectResolvedLicenses(scan, map, rootKey);
  if (!applied.nodes) return;
  // WHICH components, not only how many. The injection matches a component key
  // case-insensitively when the stored key and the scan node disagree
  // (clearSpdxKey lower-cases one side), and applied.keys is the only place that
  // divergence is visible at all: everything on screen matches exactly. Bounded,
  // because this is one log line and a module may carry up to
  // LICENSES_SELECTED_MAX resolutions of up to 250 characters each.
  const shownKeys = applied.keys.slice(0, LOGGED_APPLIED_KEYS).map(logSafe).join(', ');
  const moreKeys = applied.keys.length > LOGGED_APPLIED_KEYS ?
    ' and ' + (applied.keys.length - LOGGED_APPLIED_KEYS) + ' more' : '';
  // ONE aggregated entry per run, not one per node: a module with fifty resolved
  // components would otherwise write fifty audit records on every scan.
  await Meteor.callAsync('logEvent', user,
    'Manually set licenses applied to ' + applied.nodes +
    (applied.nodes === 1 ? ' dependency' : ' dependencies') + ' of module ' +
    logSafe(module.name) + ' in scan ' + scan._id +
    ' (components: ' + shownKeys + moreKeys + ')', 'componentLicensesApplied');
}

// Resolves and applies the root component's license:
// 1. Previously-selected license on the module wins (covers user's manual override
//    persisted via componentConfig.licensesSelected).
// 2. Otherwise the company's defaultRootComponentLicense is used as a fallback
//    (only when it still resolves to an existing private license).
// 3. The resolved license is written into the scan's root-dependency licenses array
//    so the analyzer sees the root like any other component with a detected license.
// 4. If the resolved license came from the company default and no entry existed in
//    licensesSelected, a new entry is pushed so future runs treat it as a saved choice.
// Mutates `scan` in-place; the caller persists via Scans.updateAsync below.
export async function applyRootLicense(scan, module, company, user) {
  if (!scan || !module || !company) return;
  const root = findRootDependency(scan);
  if (!root || !root.key) return;
  const rootKey = root.key;
  const fresh = await Modules.findOneAsync(module._id, {fields: {componentConfig: 1}});
  const licensesSelected = (fresh && fresh.componentConfig && fresh.componentConfig.licensesSelected) || [];
  const existing = licensesSelected.find(function (e) { return e && e.key === rootKey && e.license; });

  let resolvedLicense = existing && existing.license;
  let source = existing ? 'manual' : null;
  if (!resolvedLicense && company.defaultRootComponentLicense) {
    const privateLicenses = company.privateLicenses || [];
    const stillExists = privateLicenses.some(function (l) {
      return l && l.key === company.defaultRootComponentLicense;
    });
    if (stillExists) {
      resolvedLicense = company.defaultRootComponentLicense;
      source = 'default';
    }
  }
  if (!resolvedLicense) return;

  if (source === 'default') {
    // The read of licensesSelected above and this push are separated by an await, so two
    // concurrent scans of the same module both saw no entry and both pushed one. Selector
    // and modifier evaluate atomically against the single module document, which is what
    // makes the second one a no-op instead of a duplicate.
    await Modules.updateAsync(
      {_id: module._id, 'componentConfig.licensesSelected.key': {$ne: rootKey}},
      {
        $push: {
          'componentConfig.licensesSelected': {
            key: rootKey,
            license: resolvedLicense,
            comment: 'Auto-assigned default root-component license'
          }
        }
      });
  }

  // Replace the root dependency's license list with the resolved license so the
  // analyzer treats the root as a single-licensed component (and previously
  // injected picks don't accumulate). The entry carries an origin marker: it is
  // persisted with the scan, so the next run over this scan reads it back, and the
  // marker is what keeps the component write path from copying a per-company pick
  // onto the globally shared component document. Replacing wholesale means markers
  // never pile up here.
  const known = await Licenses.findOneAsync({key: resolvedLicense}, {fields: {key: 1, name: 1}});
  root.licenses = [rootPickLicense(resolvedLicense, (known && known.name) || resolvedLicense)];

  await Meteor.callAsync('logEvent', user,
    source === 'manual'
      ? 'Root component license "' + resolvedLicense + '" re-applied to scan ' + scan._id
      : 'Default root component license "' + resolvedLicense + '" auto-assigned for module ' + module.name,
    'scanProcessing');
}

const processScan = async function processScan(scanId, user, companyId, demo) {
  const userCompanyId = companyId || user && user.profile && user.profile.companyId;
  const scan = await Scans.findOneAsync({_id: scanId, companyId: userCompanyId});
  const company = await Companies.findOneAsync(userCompanyId);
  let counter = -1;

  function count(node) {
    counter++;
    if (node.dependencies) {
      node.dependencies.forEach(count);
    }
  }

  if (scan) {
    console.log('=> processScan: ', scan.project, scan.module);
     
    const module = await Utils.findOrCreateModuleByCompanyIdAndName(userCompanyId, scan.module, scan.moduleIdentifier, scan.projectId, user, demo);
    // The scan's dependencies are attached to this module (below), and analyzeModule
    // looks the scan up by module._id - so scan.moduleId must equal it. Set it
    // authoritatively: an import may have seeded a non-_id identifier hint here.
    scan.moduleId = module && module._id;
    // A root license applied on an earlier run is part of the stored scan (the
    // analyzer reads it from there), so re-processing walks over it again. Drop it
    // before the loop: `components` is a catalogue shared by every tenant and the
    // pick is normally one of this company's PRIVATE license keys, which
    // handleDependency would otherwise resolve and write onto the shared document.
    // Marked entries this run's applyRootLicense puts back are skipped by the write
    // path itself; this also reaches the unmarked ones stored before that marker
    // existed. The module goes in alongside the company because an unmarked entry is
    // ours only when its key is one applyRootLicense could have injected here - the
    // module's own pick for this root key, or the company default - and not merely
    // because the key happens to collide with a private license.
    const storedRoot = findRootDependency(scan);
    if (storedRoot) {
      stripInjectedRootLicenses(storedRoot, company, module);
    }
    // Guarded like the strip above: by here the in-memory scan has already been
    // mutated, so a missing company document must not throw mid-run.
    const companyPrivateLicenses = (company && company.privateLicenses) || [];
    // One collector per invocation, handed down the walk. Meteor.defer runs many
    // processScan calls on one event loop and every await below is an interleaving point,
    // so a module-level accumulator would file one tenant's skipped nodes under another
    // tenant's scan.
    const skipped = createSkipCollector();
    const ctx = {
      companyId: userCompanyId,
      user: user,
      privateLicenses: companyPrivateLicenses,
      skipped: skipped
    };
    for (const dependency of scan.dependencies || []) {
      await handleDependency(dependency, '/', ctx);
    }
    // Deliberately AFTER handleDependency: the pick is re-applied only once the
    // component documents are written, so the scan carries it for the analyzer and
    // for the scan/SBOM views without it ever being seen as a declared license by
    // this run's component write path. The same argument applies to the manually
    // resolved per-component licenses, which additionally rely on
    // handleDependency having normalised `dependency.key` to the component's own
    // key (line 425) - that is the key the UI resolves against.
    try {
      await applyResolvedLicenses(scan, module, company, user);
    } catch (resolvedLicenseError) {
      console.error('=> processScan: applyResolvedLicenses failed for scan', scanId, '-',
        resolvedLicenseError.reason || resolvedLicenseError.message || resolvedLicenseError);
    }
    // Last, so the root node is owned by exactly one writer.
    try {
      await applyRootLicense(scan, module, company, user);
    } catch (rootLicenseError) {
      console.error('=> processScan: applyRootLicense failed for scan', scanId, '-',
        rootLicenseError.reason || rootLicenseError.message || rootLicenseError);
    }
    count(scan);
    // Write back exactly what this run changed. The document was read at the top and
    // mutated across thousands of awaits, so replacing it wholesale silently discarded any
    // concurrent write to another field (binaryLinks, for one) and put a multi-MB document
    // on the wire every time. `dependencies` and `moduleId` are guarded because
    // `$set: {x: undefined}` serialises to null.
    const $set = {dependencyCount: counter};
    if (Array.isArray(scan.dependencies)) { $set.dependencies = scan.dependencies; }
    if (scan.moduleId) { $set.moduleId = scan.moduleId; }
    const modifier = {$set};
    if (skipped.count() > 0) {
      $set.skippedDependencies = skipped.entries();
      $set.skippedDependencyCount = skipped.count();
    } else {
      // A whole-document replace removed these implicitly; a $set does not. Without the
      // $unset, a record from an earlier, worse payload would outlive the payload - and a
      // re-processed scan would keep reporting losses it no longer has.
      modifier.$unset = {skippedDependencies: 1, skippedDependencyCount: 1};
    }
    await Scans.updateAsync({_id: scan._id, companyId: userCompanyId}, modifier);
    await Meteor.callAsync('logEvent', user, 'New scan '+scanId+' processed for '+module.name, 'scanProcessing');
    if (skipped.count() > 0) {
      // One aggregated entry per run, not one per node: a systematically broken payload
      // would otherwise write thousands of audit records. The scan document carries the
      // detail; this is what makes the loss visible in Company Logs.
      try {
        await Meteor.callAsync('logEvent', user,
          'Scan ' + scanId + ' for ' + module.name + ': ' + skipped.count() +
          ' dependencies skipped', 'scanProcessing');
      } catch (logError) {
        console.error('=> processScan: skipped-dependency log failed for scan', scanId, '-',
          logError.reason || logError.message || logError);
      }
    }
    try {
      await Meteor.callAsync('analyzeModule', module._id, scan.demo, user, scanId);
    } catch (error) {
      console.error('=> processScan: analyzeModule failed for scan', scanId, '-', error.reason || error.message || error);
    }
  } else {
    console.log('=> processScan: Scan with id:', scanId, 'not found');
  }
};

Meteor.methods({
  async reprocessScan(id) {
    const user = await checkIfManager();
    // processScan puts this value straight into a selector. It is company-scoped, so
    // an operator object could not cross a tenant boundary, but it could still pick
    // an arbitrary scan of the caller's own company - require a plain id.
    const scanId = asString(id);
    if (!scanId) {
      throw new Meteor.Error(400, 'Invalid scan id');
    }
    this.unblock();
    await processScan(scanId, user);
  }
});

export default processScan;


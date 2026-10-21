import _ from 'underscore';
import {SPDXParse} from '/imports/lib/spdx'
import Utils from '/imports/lib/utils';
import {preProcessLicenses} from '../scan/processScan';
import LicensesService from '/imports/api/licenses';
import {purlToKey, clearSpdxKey} from '/imports/lib/component/keyFromPurl';
import {spdxLicenseKey} from '/imports/lib/spdx/licenseKey';
import {buildSpdxGraph} from '/imports/lib/spdx/relationshipGraph';
import cydxReader from '/imports/lib/cyclonedx/reader';

const ImportConverter = {
  toScan: toScan
};

export default ImportConverter;

function toScan(type, body, params) {
  let scan = {}
  if(!params.query){
    params.query = {}
  }
  // if(!params.query.project){
  //   params.query.project = `import-${type}`
  // }
  switch (type) {
  case 'cyclonedx':
    scan = cyclonedxToScan(body, params);
    break;
  case 'spdx':
    scan = spdxToScan(body, params);
    break;
  default:
    console.log('Not expected import type')
  }
  return scan
}


// SPDX `packages` nesting comes straight from an uploaded document, so converting one level
// per stack frame overflows the call stack (a 254 KB body is enough) and anything deeper than
// ~89 levels cannot be stored in MongoDB. Children below the cap are parked in `overflow` and
// re-attached as scan roots by drainOverflow, so no package is dropped.
const MAX_NESTING = cydxReader.MAX_DEPENDENCY_NESTING;

function expandChildren(children, depth, overflow, convert) {
  if (!children || !children.length) return [];
  if (depth + 1 < MAX_NESTING) return _.map(children, (child) => convert(child));
  if (overflow) children.forEach((child) => overflow.push(child));
  return [];
}

// Index loop: converting a parked subtree can park more of its own.
function drainOverflow(overflow, convert, into) {
  for (let i = 0; i < overflow.length; i++) {
    into.push(convert(overflow[i]));
  }
}

function applyLicensePreprocessing(dependency) {
  if (Array.isArray(dependency.licenses)) {
    dependency.scannedLicenses = JSON.parse(JSON.stringify(dependency.licenses));
    dependency.licenses = preProcessLicenses(dependency.licenses);
  }
  if (Array.isArray(dependency.dependencies)) {
    dependency.dependencies.forEach(applyLicensePreprocessing);
  }
}

function cyclonedxToScan(body, params) {
  const {scan, crypto, ai} = cydxReader.parseBom(body, params);
  scan.dependencies.forEach(applyLicensePreprocessing);

  const query = (params && params.query) || {};
  const root = scan.dependencies[0];
  if (root) {
    // `scan.moduleId` must hold the real module _id (set later by scans.js handlePost
    // or processScan). Only seed it as a dedup hint when the caller did NOT name a
    // module - otherwise the UI import path (which always passes a module name) would
    // persist this non-_id string and break scan<->module linkage (analyzeModule 404).
    if (!scan.moduleId && !query.module && scan.moduleIdentifierSource) {
      scan.moduleId = scan.moduleIdentifierSource;
    }
    if (!scan.moduleIdentifier) {
      const source = scan.moduleIdentifierSource || root.name;
      scan.moduleIdentifier = Utils.generateModuleIdentifier(source);
    }
  }
  delete scan.moduleIdentifierSource;
  if (crypto && crypto.length) {
    scan.cryptoProperties = crypto;
  }
  if (ai && ai.length) {
    scan.aiProperties = ai;
  }
  return scan;
}

const spdxComponentToScanDependency = function ({Name, SPDXID, LicenseId, DownloadURL, Homepage, Version, Description, Packages},
  depth = 1, overflow) {
  let dependency = {
    name: Name,
    key: clearSpdxKey(SPDXID || Name),
    versions: [Version].filter(version => version),
    description: Description,
    private: true,
    licenses: [{name: LicenseId}].filter(({name}) => name != null && name != ''),
    homepageUrl: Homepage,
    repoUrl: DownloadURL || Homepage,
    dependencies: expandChildren(Packages, depth, overflow,
      Package => spdxComponentToScanDependency(Package, depth + 1, overflow))
  }
  dependency.scannedLicenses = dependency && dependency.licenses && JSON.parse(JSON.stringify(dependency.licenses))
  dependency.licenses = preProcessLicenses(dependency.licenses)
  return dependency
};

const spdxJsonComponentToScanDependency = function ({name, licenseDeclared, licenseConcluded, downloadLocation,
  externalRefs, versionInfo, packages}, pkgType,
{hasExtractedLicensingInfos, relationships}, depth = 1, overflow) {
  const pkgUrl = externalRefs && _.find(externalRefs, function (item){
    return item.referenceType === 'purl'
  })
  let key;
  if(pkgUrl){
    try {
      key = purlToKey(pkgUrl.referenceLocator, pkgType, name)
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (_e) {
      key = pkgType ? pkgType + ':' + name : name;
    }
  }else{
    key = pkgType ? pkgType + ':' + name : name;
  }
  let licenseName = licenseConcluded || licenseDeclared
  let licenseObj;
  if(hasExtractedLicensingInfos && licenseName && licenseName.indexOf('LicenseRef-') === 0){
    const licDetails = hasExtractedLicensingInfos.find((item)=>{
      return item.licenseId === licenseName
    })
    if(licDetails){
      const license = LicensesService.find(decodeURI(licDetails.name));
      if(license){
        let {name, key} = license
        licenseObj = {name, key}
      }else{
        licenseObj = {name: licDetails.name}
      }
    }
  }else{
    const licenseKey = spdxLicenseKey(licenseName)
    licenseObj = licenseKey ? {key: licenseKey, name: licenseName} : {name: licenseName}
  }
  return {
    name: name,
    key: clearSpdxKey(key),
    versions: [versionInfo].filter(version => version),
    private: true,
    licenses: [licenseObj].filter(({name}) => name && name != ''),
    repoUrl: downloadLocation !== 'NOASSERTION' || null,
    dependencies: expandChildren(packages, depth, overflow,
      Package => spdxJsonComponentToScanDependency(Package, pkgType,
        {hasExtractedLicensingInfos, relationships}, depth + 1, overflow))
  }
};

// Expand the `relationships` graph into the scan tree.
//
// Strategy copied from the CycloneDX reader, for the same reasons it uses it: expansion is
// ITERATIVE (a dependency chain is as long as the uploaded document makes it, and one frame per
// level overflows the call stack inside the body-size limit), and only the FIRST occurrence of a
// package carries its children - later occurrences stay leaves. That keeps the result acyclic
// (libc6 <-> libgcc-s1 in any distro SBOM) and bounded by the number of edges rather than the
// number of paths, which matters because everything downstream walks the scan as a tree.
function expandSpdxGraph(graph, pkgType, doc) {
  const carried = {};   // SPDXID -> already carries its children somewhere in the tree
  const nodes = [];
  const pending = graph.rootIds.slice();

  function nodeFor(id) {
    // `packages` is dropped: children come from the graph, not from nesting.
    const pkg = Object.assign({}, graph.byId[id], {packages: undefined});
    return spdxJsonComponentToScanDependency(pkg, pkgType, doc, 1, null);
  }

  while (pending.length) {
    const rootId = pending.shift();
    if (carried[rootId]) continue;
    carried[rootId] = true;
    const rootNode = nodeFor(rootId);
    nodes.push(rootNode);
    const work = [{id: rootId, node: rootNode, depth: 1}];
    while (work.length) {
      const item = work.pop();
      (graph.childrenOf[item.id] || []).forEach(function (childId) {
        if (childId === item.id) return;
        const childNode = nodeFor(childId);
        item.node.dependencies.push(childNode);
        if (carried[childId]) return;               // expanded elsewhere -> leaf here
        if (item.depth + 1 >= MAX_NESTING) {
          // Too deep to store; continue it as its own root instead of dropping it.
          if (pending.indexOf(childId) === -1) pending.push(childId);
          return;
        }
        carried[childId] = true;
        work.push({id: childId, node: childNode, depth: item.depth + 1});
      });
    }
  }
  return nodes;
}

function spdxToScan(body, params) {
  let spdxObject;
  let {pkgType, project, module, branch, tag, binaryLinks, demo} = params.query
  let scan = {
    project,
    module,
    branch,
    tag,
    binaryLinks,
    demo: demo === true || demo === 'true' || undefined
  }
  if(params.format === 'json'){
    spdxObject = body;
    const moduleIdentifier = Utils.generateModuleIdentifier(spdxObject.name)
    const overflow = [];
    // A conforming SPDX document keeps its packages FLAT and describes the structure in
    // `relationships`; nesting packages inside one another is not part of the spec. Reading only
    // the nested form imported every standard document as a single flat level. Use the graph
    // when the document has one, and keep the nested walk for documents that do not.
    const graph = buildSpdxGraph(spdxObject.packages, spdxObject.relationships, spdxObject.SPDXID);
    const root = spdxJsonComponentToScanDependency(
      Object.assign({}, spdxObject, graph.hasGraph ? {packages: undefined} : {}),
      pkgType, body, 1, overflow);
    if (graph.hasGraph) {
      // The document itself stays the root; what it describes hangs beneath it, so a scan keeps
      // one top-level entry and no package is lost.
      root.dependencies = expandSpdxGraph(graph, pkgType, body);
    }
    scan.dependencies = [root];
    drainOverflow(overflow,
      (Package) => spdxJsonComponentToScanDependency(Package, pkgType, body, 1, overflow),
      scan.dependencies);
    // Same treatment CycloneDX gets, and the SPDX RDF branch applies inline: keep what the
    // document declared in `scannedLicenses` and expand compound expressions in `licenses`.
    scan.dependencies.forEach(applyLicensePreprocessing);
    scan.moduleIdentifier = moduleIdentifier
    if(!scan.module) {
      scan.module = spdxObject.name
      scan.moduleId = moduleIdentifier
    }
  }else if(params.format === 'rdf'){
    spdxObject = SPDXParse(body);
    const moduleIdentifier = Utils.generateModuleIdentifier(spdxObject.Package.Name || '')
    const overflow = [];
    scan.dependencies = [spdxComponentToScanDependency(spdxObject.Package, 1, overflow)];
    drainOverflow(overflow, (Package) => spdxComponentToScanDependency(Package, 1, overflow),
      scan.dependencies);
    scan.moduleIdentifier = spdxObject.Package.SPDXID || moduleIdentifier
    if(!scan.module) {
      scan.module = spdxObject.Package && spdxObject.Package.Name
      scan.moduleId = moduleIdentifier
    }
  }
  return scan
}

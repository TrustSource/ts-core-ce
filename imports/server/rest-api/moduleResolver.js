// ---------------------------------------------------------------------------
// One module resolver for every ingest path.
//
// A dependency scan (POST /scans), an SBOM import (POST /imports/scan/*) and a
// SARIF upload (POST /tests/sarif) all have to answer the same question - "which
// module does this belong to?" - and used to answer it three different ways. The
// three paths derive `moduleIdentifier` from three different functions, so the
// same component arrived as `npm:admin-panel`, `admin-panel` or `AdminPanel`
// depending on which endpoint it came through, and an identifier-only match made
// the second upload create a duplicate module next to the first one.
//
// Precedence, first hit wins:
//   1. moduleId          - a real Modules._id
//   2. scanId/analysisId - looked up inside the caller's company, then as (1)
//   3. moduleIdentifier  - taken verbatim, NEVER re-derived from the name
//   4. moduleName        - matched by name inside the project
//   5. create            - only with `create: true` and a known project
//
// Step 4 is what makes arrival order stop mattering; it lives in
// Utils.findOrCreateModuleByCompanyIdAndName so that processScan - which resolves
// the module a second time, after the scan document is stored - matches the same
// way this resolver does.
// ---------------------------------------------------------------------------
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import Scans from '/imports/lib/collections/scans';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Utils from '/imports/lib/utils';
import {findProjectByName} from './projectResolver';
import {asString} from '/imports/lib/security/sanitizeQuery';

const MODULE_FIELDS = {_id: 1, name: 1, projectId: 1, moduleIdentifier: 1};

// Four branches below resolve a project, and a consumer cannot tell which one it got, so they
// all hand back the SAME shape. Two already projected to exactly this; the other two fetched
// whole documents. This is everything the consumers read - `_id` (resolveModuleRef below,
// tests.js) and `name` (tests.js) - and no prototype method is called on the result on any of
// those paths. (A caller that passes `project` in has already resolved it and keeps its own
// shape; scans.js does that and reads only `.module` back.)
const PROJECT_FIELDS = {_id: 1, name: 1, companyId: 1};

function notFound(description) {
  return {statusCode: 404, body: {error: 'Not Found', object: {error: description}, description}};
}

// Resolve a scanId/analysisId to the module (and scan) it belongs to. Both lookups are
// scoped to the caller's own company, so a foreign scanId/analysisId can never map to
// another tenant's module.
export async function resolveIds({companyId, moduleId, scanId, analysisId}) {
  const resolved = {moduleId: asString(moduleId), scanId: asString(scanId)};
  if (resolved.scanId && !resolved.moduleId) {
    const scan = await Scans.findOneAsync({_id: resolved.scanId, companyId}, {fields: {moduleId: 1}});
    resolved.moduleId = scan && scan.moduleId;
  }
  const analysis = asString(analysisId);
  if (analysis && (!resolved.moduleId || !resolved.scanId)) {
    const doc = await ModuleAnalysis.findOneAsync({_id: analysis, companyId},
      {fields: {moduleId: 1, scanId: 1}});
    if (!resolved.moduleId) { resolved.moduleId = doc && doc.moduleId; }
    if (!resolved.scanId) { resolved.scanId = doc && doc.scanId; }
  }
  return resolved;
}

// An explicit projectId is authoritative and never falls back to a name match; a project
// name is matched inside the caller's company. Returns {} when neither was supplied - not
// every caller knows the project, and the module may still resolve from an id.
export async function resolveProjectRef({companyId, projectId, projectName}) {
  const id = asString(projectId);
  if (id) {
    const project = await Projects.findOneAsync({_id: id, companyId}, {fields: PROJECT_FIELDS});
    return project ? {project} : {error: notFound(`Project "${id}" not found`)};
  }
  const name = asString(projectName);
  if (!name) { return {}; }
  // Shared with every other name->project site: an unordered findOneAsync here
  // could answer a different duplicate than the scan endpoint did for the same name.
  const project = await findProjectByName({companyId, name, fields: PROJECT_FIELDS});
  return project ? {project} : {error: notFound(`Project "${name}" not found`)};
}

// SARIF uploads may name a module without naming a project. Matching company-wide is a
// weaker guarantee than matching inside a project, so it stays opt-in.
async function resolveByNameAcrossProjects(companyId, moduleName) {
  const modules = await Modules.find({companyId, $or: [{name: moduleName}, {_id: moduleName}]},
    {fields: MODULE_FIELDS}).fetchAsync();
  if (!modules || !modules.length) { return null; }
  const byId = modules.find((m) => m._id === moduleName);
  if (!byId && modules.length > 1) {
    // JSON.stringify, not interpolation: a stored name may carry \n, \r or \x1b, which an
    // interpolated log line would let it use to shape extra records.
    console.warn(`Module name ${JSON.stringify(moduleName)} matches ${modules.length} modules in company`,
      companyId, '- using first match, supply a project to disambiguate');
  }
  return byId || modules[0];
}

/**
 * Resolve the module an upload belongs to.
 *
 * @param  {Object}  args
 * @param  {String}  args.companyId                  caller's company - every lookup is scoped to it
 * @param  {Object}  [args.user]                     needed when a module has to be created
 * @param  {Boolean} [args.demo]                     mark a created module as demo data
 * @param  {String}  [args.moduleId]                 a real Modules._id
 * @param  {String}  [args.scanId]                   resolved to a moduleId
 * @param  {String}  [args.analysisId]               resolved to a moduleId / scanId
 * @param  {Object}  [args.project]                  an already resolved project document
 * @param  {String}  [args.projectId]                authoritative project id
 * @param  {String}  [args.projectName]              project name, matched inside the company
 * @param  {String}  [args.moduleIdentifier]         used verbatim, never re-derived
 * @param  {String}  [args.moduleName]               display name, matched inside the project
 * @param  {Boolean} [args.create]                   create the module when nothing matched
 * @param  {Boolean} [args.touchScanned]              stamp a matched module as freshly scanned
 * @param  {Boolean} [args.allowCompanyWideNameMatch] match a name without a project
 * @return {Object}  {module, moduleId, scanId, project, error}
 */
export async function resolveModuleRef({
  companyId, user, demo,
  moduleId, scanId, analysisId,
  project, projectId, projectName,
  moduleIdentifier, moduleName,
  create = false, allowCompanyWideNameMatch = false, touchScanned = true
}) {
  const ids = await resolveIds({companyId, moduleId, scanId, analysisId});
  const result = {moduleId: ids.moduleId, scanId: ids.scanId, module: null, project: null};

  if (result.moduleId) {
    // The id wins outright. Ownership is deliberately NOT enforced here: the write paths
    // do it (testImports/create.js answers a foreign moduleId with 403) and swallowing it
    // here would turn that refusal into a silent "unresolved" success.
    result.module = await Modules.findOneAsync({_id: result.moduleId, companyId}, {fields: MODULE_FIELDS});
    if (result.module && result.module.projectId) {
      result.project = await Projects.findOneAsync(result.module.projectId, {fields: PROJECT_FIELDS});
    }
    return result;
  }

  let targetProject = project;
  if (!targetProject) {
    const projectRef = await resolveProjectRef({companyId, projectId, projectName});
    if (projectRef.error) {
      result.error = projectRef.error;
      return result;
    }
    targetProject = projectRef.project;
  }
  result.project = targetProject || null;

  const name = asString(moduleName);
  const identifier = asString(moduleIdentifier);

  if (targetProject && (name || identifier)) {
    if (create) {
      result.module = await Utils.findOrCreateModuleByCompanyIdAndName(
        companyId, name || identifier, identifier || name, targetProject._id, user, demo, touchScanned);
    } else {
      result.module = await Modules.findOneAsync({
        companyId,
        projectId: targetProject._id,
        $or: [{moduleIdentifier: identifier || name}, {name: name || identifier}]
      }, {fields: MODULE_FIELDS});
    }
    result.moduleId = result.module && result.module._id;
    return result;
  }

  if (name && allowCompanyWideNameMatch) {
    const module = await resolveByNameAcrossProjects(companyId, name);
    if (module) {
      result.module = module;
      result.moduleId = module._id;
      if (module.projectId) {
        result.project = await Projects.findOneAsync(module.projectId, {fields: PROJECT_FIELDS});
      }
    }
  }
  return result;
}

export default {resolveModuleRef, resolveIds, resolveProjectRef};

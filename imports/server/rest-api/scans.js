import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Utils from '/imports/server/ServerUtils';
import Scans from '/imports/lib/collections/scans';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Projects from '/imports/lib/collections/projects';
import processScan from '/imports/server/scan/processScan';
import RestApi from './RestApi';
import {resolveModuleRef} from './moduleResolver';
import {findProjectByNameOrId} from './projectResolver';
import {helpers} from './apiSchema';
import {MAX_SCAN_DEPENDENCY_DEPTH, findDepthViolation, describeDepthViolation,
  MAX_SCAN_BODY_DEPTH, findBodyDepthViolation,
  describeBodyDepthViolation} from '/imports/server/scan/dependencyDepth';
import {CryptoPropertiesPersistImported} from '/imports/lib/interactors/cryptoProperties';
import {AiPropertiesPersistImported} from '/imports/lib/interactors/aiProperties';
import {asString} from '/imports/lib/security/sanitizeQuery';

const METHOD_NA = 'Method Not Allowed'
const APP_JSON = 'application/json'
const CONTENT_TYPE = 'Content-Type'
const SCAN_NF = 'Scan not found: '
const SCOPE_LIMITED = 'API-key scope is limited'

const FETCH_LIMIT = 100;

// Stored on every scan as `apiVersion`; module imports store the same constant.
const API_VERSION = 2;

Router.route('/api/v2/core/scans', {
  name: 'apiScansRoute',
  where: 'server',
  action: RestApi.wrapAsync(transferScans),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/scans/:id', {
  name: 'apiScanRoute',
  where: 'server',
  action: RestApi.wrapAsync(getInformationByScan),
  trackPageView: false
});

Router.route('/api/v2/core/scans/:id/reprocess', {
  name: 'apiScanReprocessRoute',
  where: 'server',
  action: RestApi.wrapAsync(reprocessByScan),
  trackPageView: false
});

Router.route('/api/v2/core/scans/:id/binaryLinks', {
  name: 'apiScanBinaryLinksRoute',
  where: 'server',
  action: RestApi.wrapAsync(getInformationByScanBinaryLinks),
  trackPageView: false
});

const RestApiScans = {
  handlePost: handlePost,
  // Shared with the UI import path (imports/startup/server/moduleImports.js) so both ingest
  // routes run the same validation, module resolution and analysis trigger.
  ingestScan: ingestScan
};

export default RestApiScans;

async function transferScans() {
  RestApi.requestLogger(this.request, this.params, 'scans');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
   
  this.response.setHeader('Access-Control-Allow-Origin', '*');
   
  this.response.setHeader('Access-Control-Allow-Methods', '*');
   
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await handlePost(this.request, this.params, this.response);
  } else if (this.request.method === 'GET') {
    await handleGet(this.request, this.params, this.response);
  }  else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getInformationByScan() {
  RestApi.requestLogger(this.request, this.params, 'scans/:id');
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getInformationByScanBinaryLinks() {
  RestApi.requestLogger(this.request, this.params, 'scans/:id/binaryLinks');
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await handlePostBinaryLinks(this.request, this.params, this.response);
  } else if (this.request.method === 'GET') {
    await handleGetBinaryLinks(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

//
//    OPTIONS
//
function handleOptions(response) {
  // console.log('now in handleOptions');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

//
//    GET Requests
//
async function handleGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey( headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    const query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader('Cache-Control', 'no-cache, no-store');
    // SINGLE scan
    if (params.id) {
      query._id = params.id;

      const scan = await Scans.findOneAsync(query, {
        fields: {_id: 1, moduleId: 1, project: 1, module: 1, branch: 1, tag: 1, binaryLinks: 1, submitted: 1}});
      if(scan){
        let result = {};
        let filter = {
          scanId: params.id,
          moduleId: scan.moduleId,
          companyId: keyMetaAndCompany.company._id
        };
        result._id = scan._id;
        const module = await Modules.findOneAsync(scan.moduleId, {fields: {name: 1, projectId: 1, status: 1, description: 1}});
        if (module) {
          result.projectId = module.projectId || Projects.UNASSIGNED;
          // absoluteUrl joins ROOT_URL and the path with exactly one slash.
          result.url = Meteor.absoluteUrl('projects/'+result.projectId+'/modules/'+scan.moduleId+'/dependencies');
        }
        result.project = scan.project;
        result.moduleId = scan.moduleId;
        result.module = scan.module;
        let analysis = await ModuleAnalysis.findOneAsync(filter, {sort: {'date': -1}, fields:{date: 1, statistics: 1}});
        if(analysis){
          result.analysisStatus = 'Finished';
          result.analysisDate = analysis.date;
          result.statistics = analysis.statistics;
        }else{
          result.analysisStatus = 'In progress';
        }
        result.branch = scan.branch || null;
        result.tag = scan.tag || null;
        if(scan.binaryLinks){
          result.binaryLinks = _.map(scan.binaryLinks,function (link) {
            return {
              name: link.name,
              comment: link.comment,
              userName: link.userName

            };
          });
        }
        response.end(JSON.stringify(result));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(SCAN_NF + params.id));
      }
    }else{
      // Scans list
      let scans;
      const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0)*FETCH_LIMIT)
      const options = {limit: FETCH_LIMIT, skip,
        fields: {_id: 1, moduleId: 1, project: 1, module: 1, branch: 1, tag: 1, binaryLinks: 1, submitted: 1}, sort:{submitted: -1}};

      scans = await Scans.find(query, options).fetchAsync();

      if (scans.length === options.limit) {
        // Partial Content,
        // TODO:  this is not conform with spec http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
        //        concerning the mandatory header fields
        response.statusCode = 200;
      }
      response.end(JSON.stringify(scans));
    }
  }
}

async function handleGetBinaryLinks(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey( headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    const query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader('Cache-Control', 'no-cache, no-store');
    // SINGLE scan
    if (params.id) {
      query._id = params.id;

      const scan = await Scans.findOneAsync(query, {fields: {_id: 1, binaryLinks: 1}});
      if(scan){
        let result = {};
        result.binaryLinks = _.map(scan.binaryLinks,function (link) {
          return {
            name: link.name,
            comment: link.comment,
            userName: link.userName

          };
        });
        response.end(JSON.stringify(result));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(SCAN_NF + params.id));
      }
    }
  }
}

//
//    POST Requests
//
 
// Find the project a scan belongs to, always inside the caller's company.
//
// An explicit `projectId` is authoritative and is never allowed to fall back to a name match:
// the UI import knows exactly which project the user picked, and a company that has two
// projects with the same name would otherwise be able to attach the scan to the wrong one.
// Without an id, `project` from the payload is matched as either a name or an id, and an id
// match wins over a name match.
//
// The name arm delegates to the shared resolver: it used to answer `projects[0]`,
// so a company that already carried two same-named projects got whichever row Mongo returned
// first, and a scan could land under a different one than the SARIF upload naming the same
// project did.
async function resolveProject(companyId, projectId, projectNameOrId) {
  const explicitId = asString(projectId);
  if (explicitId) {
    return await Projects.findOneAsync({_id: explicitId, companyId: companyId});
  }
  return await findProjectByNameOrId({companyId: companyId, nameOrId: projectNameOrId});
}

// `moduleName` is the canonical name of this parameter across the ingest endpoints.
// `module` - what ts-scan sends in the body - stays accepted, and either
// spelling is read from the query string for clients that cannot shape the body. Runs
// BEFORE cleanAndValidateScan: ApiScanSchema declares no `moduleName`, so clean() would
// drop it before it could be read.
function applyModuleNameAlias(body, query) {
  if (!body || typeof body !== 'object') { return; }
  const q = query || {};
  const name = asString(body.module) || asString(body.moduleName)
    || asString(q.moduleName) || asString(q.module);
  if (name) { body.module = name; }
  delete body.moduleName;
}

// Everything a scan goes through once the caller is known and authorized: schema validation,
// project resolution, module resolve/create, content notices, crypto/AI properties, the insert
// and the deferred analysis. Transport-independent - it returns a result object instead of
// writing to an HTTP response - so the REST endpoint and the UI import (a Meteor method with a
// logged-in user rather than an API key) share ONE implementation and therefore produce
// identical scan documents and identical warnings.
//
// caller:    {company, user} - already authenticated and authorized by the transport.
// query:     optional query-string parameters, read only for the module-name aliases below.
// projectId: optional, and deliberately NOT part of `body` - cleanAndValidateScan() below runs
//            ApiScanSchema.clean({filter: true}) and the schema declares no `projectId`, so a
//            body field of that name is stripped before it can be read. A transport that
//            already resolved the project (the UI import has the id in hand) passes it here.
// Returns {ok: true, statusCode: 201, scanId, moduleId, projectStatus, contextDependency,
//          contentNotices} or {ok: false, statusCode, error} / {ok: false, statusCode, context}.
async function ingestScan({body, caller, apiVersion, userAgentStatus, projectId, query}) {
  applyModuleNameAlias(body, query);
  // FIRST, before anything else touches the tree. cleanAndValidateDependency recurses one
  // frame per level and SimpleSchema.clean walks the whole graph, so a pathological chain
  // would blow the stack there and come back as the 500 this guard exists to replace. It
  // also sits ahead of module resolution and the insert, which is what makes a rejected
  // payload leave nothing behind rather than an orphan module.
  //
  // The `error` arm, not the `context` arm: handlePost renders `context` through
  // RestApi.createErrorResponse, which needs a live SimpleSchema context, and the UI import
  // maps the `context` arm to a fixed string while it passes `error.description` through.
  const tooDeep = findDepthViolation(body && body.dependencies, MAX_SCAN_DEPENDENCY_DEPTH);
  if (tooDeep) {
    const description = describeDepthViolation(tooDeep, MAX_SCAN_DEPENDENCY_DEPTH);
    return {ok: false, statusCode: 400, error: {
      error: 'Bad Request',
      object: 'Dependency:' + (tooDeep.name || tooDeep.key || tooDeep.purl || ''),
      description: description,
      messages: [{
        message: description,
        details: {name: 'dependencies', type: 'maxNesting', value: tooDeep.depth}
      }]
    }};
  }
  // ...and the same question asked of everything else in the body. The check above walks
  // `dependencies`, which is where a scanner nests - but nothing stopped a client nesting
  // under any other key, and SimpleSchema.clean's MongoObject walk below is recursive and
  // descends into blackbox fields (`meta`) as readily as into unknown ones. Both were live
  // 500s: an unknown key nested 2000 deep gave "Maximum call stack size exceeded", and a
  // `meta` nested 500 deep inside a dependency gave "BSONObj exceeds maximum nested object
  // depth". Second, not first, so a too-deep dependency chain keeps naming the dependency.
  const bodyTooDeep = findBodyDepthViolation(body, MAX_SCAN_BODY_DEPTH);
  if (bodyTooDeep) {
    const description = describeBodyDepthViolation(bodyTooDeep, MAX_SCAN_BODY_DEPTH);
    return {ok: false, statusCode: 400, error: {
      error: 'Bad Request',
      object: 'Payload:' + (bodyTooDeep.path || ''),
      description: description,
      messages: [{
        message: description,
        details: {name: bodyTooDeep.path || 'body', type: 'maxNesting', value: bodyTooDeep.depth}
      }]
    }};
  }
  const context = helpers.cleanAndValidateScan(body);
  let contextDependency = null;
  if (context.isValid() && body.dependencies) {
    _.each(body.dependencies, function (dependency) {
      const dependencyContext = helpers.cleanAndValidateDependency(dependency);
      // Hold on to the FIRST invalid tree - that is the one the response `warning` names.
      // The predicate here used to test `context`, the SCAN context, which is valid by the
      // time this loop runs and is never touched by cleanAndValidateDependency, so an
      // invalid first dependency was overwritten by a later valid sibling and vanished
      // from the response entirely.
      //
      // Deliberately NOT a short-circuit: cleanAndValidateDependency() mutates the object
      // that gets stored (trimming, unknown-key filtering, dropping URLs that do not
      // validate), so stopping early would persist the remaining top-level dependencies
      // uncleaned. Only the reporting stops at the first invalid tree.
      if (!contextDependency || contextDependency.isValid()) {
        contextDependency = dependencyContext;
      }
    });
  }
  if (!context.isValid()) {
    return {ok: false, statusCode: 400, context: context};
  }

  const companyId = caller.company._id;
  const project = await resolveProject(companyId, projectId, body.project);
  if (!project) {
    const requested = asString(projectId) || body.project;
    return {ok: false, statusCode: 404, error: {
      error: 'Not Found',
      object: {error: 'Resource not found: ' + requested},
      description: 'Resource not found: ' + requested
    }};
  }

  const projectStatus = RestApi.evaluateProject(project, body.project);
  const scan = _.extend(body, {
    projectId: project._id,
    companyId: companyId,
    submitted: new Date(),
    moduleIdentifier: body.moduleId ? body.moduleId : Utils.cleanAndFixIdentifier(body.module),
    apiVersion: apiVersion
  });
  scan.contentNotices = await getContentNotices(scan, caller.company.privateLicenses);
  const contentNotices = joinContentNotices(null, scan.contentNotices);
  scan.binaryLinks = processBinaryLinks(body.binaryLinks, caller.user);
  // One resolver for every ingest path, so a scan attaches to the module a SARIF upload
  // or an earlier import already created for this name instead of duplicating it.
  const resolvedModule = await resolveModuleRef({
    companyId: companyId,
    user: caller.user,
    demo: scan.demo,
    project: project,
    moduleIdentifier: scan.moduleIdentifier,
    moduleName: scan.module,
    create: true
  });
  const module = resolvedModule.module;
  scan.moduleId = module._id;
  if (Array.isArray(scan.cryptoProperties) && scan.cryptoProperties.length) {
    try {
      await CryptoPropertiesPersistImported({
        list: scan.cryptoProperties,
        companyId: companyId,
        projectId: scan.projectId,
        moduleId: module._id,
        user: caller.user
      });
    } catch (e) {
      console.log('persist imported cryptoProperties error:', e);
    }
    delete scan.cryptoProperties; // keep it out of the stored scan document
  }
  if (Array.isArray(scan.aiProperties) && scan.aiProperties.length) {
    try {
      await AiPropertiesPersistImported({
        list: scan.aiProperties,
        companyId: companyId,
        projectId: scan.projectId,
        moduleId: module._id,
        user: caller.user
      });
    } catch (e) {
      console.log('persist imported aiProperties error:', e);
    }
    delete scan.aiProperties; // keep it out of the stored scan document
  }
  const scanId = await Scans.insertAsync(cleanDoc(scan));
  Meteor.defer(async function () {
    try {
      await processScan(scanId, caller.user, companyId, scan.demo);
    } catch (err) {
      console.log('processScan error: ', err)
    }
    Meteor.defer(async function () {
      // sendMailToUser's second argument is the MODULE - it names the scan in the audit
      // entry ("created for ...") and in the notification body ("for module: ..."), both
      // of which were showing the project name.
      await RestApi.sendMailToUser(caller.user, scan.module, scanId);
    });
  });
  return {
    ok: true,
    statusCode: 201,
    scanId: scanId,
    moduleId: module._id,
    projectStatus: projectStatus,
    contextDependency: contextDependency,
    contentNotices: contentNotices,
    userAgentStatus: userAgentStatus
  };
}

async function handlePost(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const userAgentStatus = RestApi.evaluateUserAgent(headers['user-agent']);
  if (userAgentStatus.error) {
    response.statusCode = userAgentStatus.error; // Forbidden
    response.end(JSON.stringify(userAgentStatus.message));
    return;
  }

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if(body && keyMetaAndCompany && keyMetaAndCompany.user && keyMetaAndCompany.user.profile && keyMetaAndCompany.user.profile.name){
    body.user = keyMetaAndCompany.user.profile.name;
  }

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  const result = await ingestScan({
    body: body,
    caller: {company: keyMetaAndCompany.company, user: keyMetaAndCompany.user},
    apiVersion: API_VERSION,
    userAgentStatus: userAgentStatus,
    query: params && params.query
  });

  if (result.ok) {
    response.statusCode = result.statusCode;
    response.end(createOKResponse(result.scanId, result.moduleId, userAgentStatus,
      result.projectStatus, result.contextDependency, result.contentNotices));
    return;
  }
  response.statusCode = result.statusCode;
  if (result.context) {
    const respStr = RestApi.createErrorResponse(result.context, userAgentStatus, null);
    console.log('Error processing scan: ', respStr);
    response.end(respStr);
    return;
  }
  response.end(JSON.stringify(result.error));
}

function isPlainObject(v) {
  return Object.prototype.toString.call(v) === '[object Object]';
}
function cleanDoc(input) {
  function clean(v) {
    if (v == null) return undefined;
    if (Array.isArray(v)) {
      const arr = v.map(clean).filter(x => x !== undefined);
      return arr.length ? arr : undefined;
    }
    if (isPlainObject(v)) {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const cv = clean(val);
        if (cv !== undefined) out[k] = cv;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return v;
  }
  const cleaned = clean(input);
  return cleaned === undefined ? {} : cleaned;
}

//
//    POST Requests
//
 
async function reprocessByScan() {
  RestApi.requestLogger(this.request, this.params, 'scans/reprocess');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await postReprocessByScan(this.request, this.params, this.response);
  }  else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}
async function postReprocessByScan(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if(body && keyMetaAndCompany && keyMetaAndCompany.user && keyMetaAndCompany.user.profile && keyMetaAndCompany.user.profile.name){
    body.user = keyMetaAndCompany.user.profile.name;
  }

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
    'company_security_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  if (params.id) {
    const scanId = params.id;
    const companyId = keyMetaAndCompany.company._id;
    // Only the owning company may reprocess a scan - verify ownership before
    // deferring, otherwise a tenant could trigger reprocessing of another
    // tenant's scan (under that tenant's context) by guessing the id.
    const owned = await Scans.findOneAsync({_id: scanId, companyId}, {fields: {_id: 1, demo: 1}});
    if (!owned) {
      response.statusCode = 404;
      response.end(JSON.stringify(SCAN_NF + scanId));
      return;
    }
    Meteor.defer(async function () {
      try {
        await processScan(scanId, keyMetaAndCompany.user, companyId, owned.demo);
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_err) { /* intentionally ignored */ }
    });
    response.statusCode = 201;
    response.end(createOKResponse(scanId));
  }
}

async function handlePostBinaryLinks(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  const context = helpers.cleanAndValidateScanBinaryLinks(body);
  if (context.isValid()) {
    const query = {companyId: keyMetaAndCompany.company._id};
    if (params.id) {
      query._id = params.id;
    }
    const {binaryLinks} = body;
    const $set = {binaryLinks: processBinaryLinks(binaryLinks, keyMetaAndCompany.user)};
    const updated = await Scans.updateAsync(query,{$set});
    if(updated > 0){
      response.statusCode = 201;
      response.end(JSON.stringify({scanId: params.id}));
    }else{
      response.statusCode = 404;
      response.end(JSON.stringify(SCAN_NF + params.id));
    }
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error processing scan: ', respStr);
    response.end(respStr);
  }
}

function processBinaryLinks(links, user) {
  if(links && links.length){
    return _.map(links, function (link) {
      let linkItem = link;
      linkItem.userId = user._id;
      linkItem.userName = user.profile.name;
      linkItem.locked = true;
      linkItem.created = new Date();
      return linkItem
    });
  }
  return []
}

function createOKResponse(scanId, moduleId, userAgentStatus, projectStatus, contextDependency, contentNotices) {
  const result = {
    scanId,
    moduleId
  };
  if(contextDependency && contextDependency.__errorObject){
    const warning = {
      object: contextDependency.__errorObject,
      messages: []
    };
    const keys = contextDependency.validationErrors();
    if (keys instanceof Array) {
      keys.forEach(function (key) {
        const msg = contextDependency.keyErrorMessage(key.name);
        warning.messages.push({
          message: msg,
          details: key
        });
      });
    }
    result.warning =  warning;
  }
  if(contentNotices){
    result.contentNotices = contentNotices;
  }
  if (userAgentStatus && userAgentStatus.message) {
    result.info = userAgentStatus.message;
  }
  if (projectStatus && projectStatus.message) {
    result.info = result.info ? result.info + '; ' +projectStatus.message : projectStatus.message;
  }
  return JSON.stringify(result);
}

async function getContentNotices(body, privateLicenses) {
  let contentNotices = null;
  if (body.dependencies) {
    let validationMessages = [];
    // validateDependencyLicenses is async - it must be awaited, otherwise
    // Promises end up in validationMessages and every scan with dependencies
    // produces bogus "undefined - undefined" notices.
    for (const dependency of body.dependencies) {
      validationMessages.push(await helpers.validateDependencyLicenses(dependency, privateLicenses));
    }
    validationMessages = _.flatten(validationMessages)
    if(validationMessages.length){
      contentNotices = {
        types: {},
        notices: []
      };
      if (validationMessages instanceof Array) {
        validationMessages.forEach(function (message) {
          if(!contentNotices.types[message.type]){
            contentNotices.types[message.type] = 1
          }else{
            contentNotices.types[message.type] = contentNotices.types[message.type] + 1
          }
          contentNotices.notices.push({
            message: message.type,
            details: message.name + ' - ' + message.value
          });
        });
      }
    }
  }
  return contentNotices
}

function joinContentNotices(a, b) {
  if (a && b) {
    let contentNotices = {
      types: {},
      notices: []
    };
    let notices = a.notices.concat(b.notices);
    if (notices instanceof Array) {
      notices.forEach(function (message) {
        if(!contentNotices.types[message.message]){
          contentNotices.types[message.message] = 1
        }else{
          contentNotices.types[message.message] = contentNotices.types[message.message] + 1
        }
        contentNotices.notices.push({
          message: message.message,
          details: message.details
        });
      });
    }
    return contentNotices
  }else if(a){
    return a
  }else if (b){
    return b
  }
}

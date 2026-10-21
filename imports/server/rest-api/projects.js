import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import RestApi from './RestApi';
import {findProjectByName} from './projectResolver';
import {helpers} from './apiSchema';
import {Meteor} from 'meteor/meteor';
import Utils from '/imports/server/ServerUtils';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';
import {toEnvironmentalContext} from '/imports/lib/converter/environmentalContext';
import {PROJECT_DESCRIPTION_MAX} from '/imports/lib/schemas/projectSchema';

const FETCH_LIMIT = 100;
const RESOURCE_NF = 'Resource not found: '
const SCOPE_LIMITED = 'API-key scope is limited'
const BOM_READ_ROLES = ['manager', 'compliance_manager', 'portfolio_manager', 'company_security_manager'];
// Shared with the generic project POST handler below (handlePost) - factored
// out since it now appears twice (architecture POST route).
const PROJECT_POST_ROLES = ['developer', 'manager', 'portfolio_manager'];
// POST /api/v2/core/projects/:id blanket-merges every non-`$` body field, so each new
// ProjectSchema field becomes writable over REST the moment it exists. These are
// the fields whose DDP toggles reserve themselves for managers, and this is the
// ONE list that keeps the two surfaces in step - guarding a single
// field name here put the next feature one forgotten copy away from a
// `developer`-scoped CI key flipping a security control.
//
// PROJECT_POST_ROLES includes `developer`, so without this a CI credential could
// enable the CWE risk register, or silence a project's vulnerability alerts,
// while the UI reserves both for managers. `vulnerabilityAlertSweptAt` is in the
// list because it is sweep bookkeeping, never a customer setting: writing it
// forward would let a caller skip a project's rotation slot indefinitely.
//
// Enforced only when the body actually carries one of them, so no existing POST
// changes behaviour.
const MANAGER_ONLY_POST_FIELDS = ['autoCreateCweRisks', 'vulnerabilityAlertSweptAt'];
const MANAGER_ONLY_POST_ROLES = ['account_admin', 'manager', 'compliance_manager'];
// The single-project API shape, shared by the GET arm and the update arm's read-back.
//
// A WHITELIST, not an exclusion list. The update arm used to answer with an unprojected
// `findOneAsync`, i.e. the whole stored document - `jira.passwd`, `jira.user`, `tfs.token`,
// `github.token` and `relatedUsers` included - behind PROJECT_POST_ROLES, which includes
// `developer`, while reading the same project through GET requires a manager-tier scope. An
// exclusion list would close today's leak and fail open on the next one: whatever integration
// field somebody adds to ProjectSchema would be echoed by default.
//
// One constant used by both arms is also the drift guard. They diverged in the first place
// because each carried its own projection, and only one of them was ever narrowed.
const PROJECT_API_FIELDS = {
  name: 1, description: 1, requireWhitelist: 1, tags: 1, confidenceMinScore: 1,
  licenseConfig: 1, componentConfig: 1, cveConfig: 1, obligationConfig: 1,
  legalRulesConfig: 1, requirements: 1, ciaRequirements: 1,
  endoflifePolicy: 1, autoCreateCweRisks: 1
  // The alert switches are deliberately ABSENT: REST exposure of them
  // is out of scope, so they are neither returned here nor documented in
  // openapi.yaml. The POST guard above still covers them, because the blanket
  // merge would let a body write them whether or not this projection reads them
  // back.
};

Router.route('/api/v2/core/projects', {
  name: 'apiProjectsRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjects),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/projects/:id', {
  name: 'apiProjectRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjects),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/projects/:id/partsList', {
  name: 'apiProjectPartsListRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjects),
  trackPageView: false                // don't report page changes to google analytics
});

// SBOM, AIBOM (AI/ML-BOM) and CBOM (Cryptography-BOM) request endpoints. GET serializes
// the whole project's BOM as CycloneDX 1.7, filtered to the requested variant. The SBOM
// endpoint still answers the previous TrustSource JSON (tree and list) for
// ?format=trustsource.
Router.route('/api/v2/core/projects/:id/sbom', {
  name: 'apiProjectSbomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectBom),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/projects/:id/aibom', {
  name: 'apiProjectAibomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectBom),
  trackPageView: false
});

Router.route('/api/v2/core/projects/:id/cbom', {
  name: 'apiProjectCbomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectBom),
  trackPageView: false
});

// Environmental (iCVSS) context: GET returns one environmental
// context object per module in the project (CR/IR/AR + CVSS environmental
// vectors + parsed MAV). Read-only; mirrors getProjectBom's auth/CORS.
Router.route('/api/v2/core/projects/:id/environmental-context', {
  name: 'apiProjectEnvironmentalContextRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectEnvironmentalContext),
  trackPageView: false
});

// Architecture upload/read: POST stores an architecture.md's
// content into the project's `description` ("Application goals") field; GET
// reads it back.
Router.route('/api/v2/core/projects/:id/architecture', {
  name: 'apiProjectArchitectureRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectArchitecture),
  trackPageView: false
});

function projectBomVariantFromUrl(url) {
  if (!url) return undefined;
  const path = url.split('?')[0];
  if (path.indexOf('/aibom') !== -1) return 'AIBOM';
  if (path.indexOf('/cbom') !== -1) return 'CBOM';
  if (path.indexOf('/sbom') !== -1) return 'SBOM';
  return undefined;
}

async function getProjectBom() {
  RestApi.requestLogger(this.request, this.params, 'projects');
  this.response.statusCode = 200;
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  const variant = projectBomVariantFromUrl(this.request.url);

  if (this.request.method === 'GET') {
    await handleProjectBomGet(this.request, this.params, this.response, variant);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

async function handleProjectBomGet(request, params, response, variant) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }
  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, BOM_READ_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  const companyId = keyMetaAndCompany.company._id;
  response.setHeader('Cache-Control', 'no-cache, no-store');
  if (!params.id) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  const project = await Projects.findOneAsync({_id: params.id, companyId}, {fields: {_id: 1}});
  if (!project) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  const report = await Meteor.callAsync('getProjectSBOM', params.id, companyId);
  const format = request.query && request.query.format;
  if (variant === 'SBOM' && format === 'trustsource') {
    response.end(JSON.stringify(report));
    return;
  }
  if (format !== undefined && format !== 'cyclonedx') {
    response.statusCode = 400;
    response.end(JSON.stringify(`Unsupported format: ${String(format)}`));
    return;
  }
  const doc = reportSbomFileService.getCycloneDxDetails(report, variant);
  response.end(JSON.stringify(doc));
}

//
//    Environmental (iCVSS) context - GET/OPTIONS dispatch, mirrors getProjectBom's shape.
//
async function getProjectEnvironmentalContext() {
  RestApi.requestLogger(this.request, this.params, 'projects');
  this.response.statusCode = 200;
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleProjectEnvironmentalContextGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

// GET /api/v2/core/projects/:id/environmental-context - one environmental-context
// entry per module in the project. companyId comes ONLY from the API key: the
// project is verified to belong to the company first (foreign id -> 404), then
// the module query is re-scoped by the SAME company so a project id can never
// surface another tenant's modules. `?page=` pages a bounded window sorted by name.
async function handleProjectEnvironmentalContextGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }
  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, BOM_READ_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  const companyId = keyMetaAndCompany.company._id;
  response.setHeader('Cache-Control', 'no-cache, no-store');
  if (!params.id) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  const project = await Projects.findOneAsync({_id: params.id, companyId}, {fields: {_id: 1}});
  if (!project) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  // Bounded, deterministic page (name asc, _id tiebreak so ties are stable
  // rather than left to Mongo row order).
  const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0) * FETCH_LIMIT);
  const options = {
    limit: FETCH_LIMIT,
    skip,
    sort: {name: 1, _id: 1},
    fields: {name: 1, projectId: 1, ciaRequirements: 1, environmentalConfig: 1}
  };
  const modules = await Modules.find({projectId: params.id, companyId}, options).fetchAsync();
  response.end(JSON.stringify(modules.map(toEnvironmentalContext)));
}

//
//    Architecture - GET/POST/OPTIONS dispatch, mirrors getProjectBom's shape.
//
async function getProjectArchitecture() {
  RestApi.requestLogger(this.request, this.params, 'projects');
  this.response.statusCode = 200;
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleArchitectureGet(this.request, this.params, this.response);
  } else if (this.request.method === 'POST') {
    await handleArchitecturePost(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

async function handleArchitectureGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }
  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, BOM_READ_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  const companyId = keyMetaAndCompany.company._id;
  response.setHeader('Cache-Control', 'no-cache, no-store');
  const project = await Projects.findOneAsync({_id: params.id, companyId}, {fields: {description: 1}});
  if (!project) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  response.end(JSON.stringify({content: project.description || ''}));
}

async function handleArchitecturePost(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }
  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, PROJECT_POST_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  const companyId = keyMetaAndCompany.company._id;

  // Strip MongoDB operators from body before use - this file's established
  // Mongo-operator-injection convention (see handlePost above).
  const body = request.body || {};
  const safeBody = {};
  _.each(body, function (value, key) { if (!key.startsWith('$')) safeBody[key] = value; });

  const project = await Projects.findOneAsync({_id: params.id, companyId}, {fields: {_id: 1}});
  if (!project) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }

  const content = safeBody.content;
  if (typeof content !== 'string') {
    response.statusCode = 400;
    response.end(JSON.stringify({error: 'Invalid content'}));
    return;
  }
  if (content.length > PROJECT_DESCRIPTION_MAX) {
    response.statusCode = 400;
    response.end(JSON.stringify({error: 'Content too large'}));
    return;
  }

  await Projects.updateAsync({_id: params.id, companyId}, {$set: {description: content}});
  response.end(JSON.stringify({projectId: params.id, content}));
}

async function getProjects() {
  RestApi.requestLogger(this.request, this.params, 'projects');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await handlePost(this.request, this.params, this.response);
  } else if (this.request.method === 'GET') {
    await handleGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else if (this.request.method === 'DELETE') {
    await handleDelete(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}
//
//    POST Requests
//
async function handlePost(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, PROJECT_POST_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  // Strip MongoDB operators from body before merging
  const safeBody = {};
  _.each(body, function (value, key) { if (!key.startsWith('$')) safeBody[key] = value; });
  // A manager-level scope for the fields the DDP toggles reserve for managers.
  // Everything else on this body keeps PROJECT_POST_ROLES.
  const managerOnly = MANAGER_ONLY_POST_FIELDS.some(function (field) {
    return Object.prototype.hasOwnProperty.call(safeBody, field);
  });
  if (managerOnly &&
      !Utils.validateKeyScope(keyMetaAndCompany.keyMeta, MANAGER_ONLY_POST_ROLES)) {
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  let project = _.extend(safeBody, {
    companyId: keyMetaAndCompany.company._id
  });
  if (!params.id) {
    project.creationDate = new Date()
  }else{
    const current = await Projects.findOneAsync(
      {_id: params.id, companyId: keyMetaAndCompany.company._id}, {fields:{name:1}});
    if(!current){
      response.statusCode = 404;
      response.end(JSON.stringify(RESOURCE_NF + params.id));
      return;
    }
    project = _.extend(current, project);
  }
  const context = helpers.cleanAndValidateProject(project);
  if (context.isValid()) {
    if (!params.id) {
      // Create is idempotent on {companyId, name}. It runs HERE, after
      // cleanAndValidateProject: clean() trims `name` in place, so `"  Foo  "` and `"Foo"`
      // dedup to one row, and an invalid name still answers 400 below rather than matching
      // an existing project. The company is the AUTHENTICATED one, never project.companyId.
      // The existing project is returned unmodified - no field of this body is written to
      // it - and `existing: true` is the machine-readable signal that nothing was created.
      const existing = await findProjectByName({
        companyId: keyMetaAndCompany.company._id,
        name: project.name,
        fields: {_id: 1}
      });
      if (existing) {
        response.statusCode = 200;
        response.end(createOKResponse(existing._id, true));
        return;
      }
      const projectId = await Projects.insertAsync(project);
      response.statusCode = 201;
      response.end(createOKResponse(projectId));
    }else{
      try {
        const count = await Projects.updateAsync(
          {_id: params.id, companyId: keyMetaAndCompany.company._id}, {$set: project});
        if(count === 1){
          // Echoed through the SAME projection the GET arm uses. This read used to be
          // unprojected, so a `developer`-scoped key could POST any project id and read
          // back the jira/tfs/github credentials and relatedUsers that the GET arm
          // reserves for a manager-tier scope.
          const current = await Projects.findOneAsync(
            {_id: params.id, companyId: keyMetaAndCompany.company._id},
            {fields: PROJECT_API_FIELDS});
          response.statusCode = 200;
          response.end(JSON.stringify(current));
        }
      }catch (e) {
        response.statusCode = 400;
        const respStr = {error: e.toString()};
        console.log('Error updating project: ', respStr);
        response.end(respStr);
      }
    }
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error creating/updating project: ', respStr);
    response.end(respStr);
  }
}
// `existing` is set only when the name already had a project, so the body of a real
// create stays byte-identical to what this endpoint has always returned.
function createOKResponse(projectId, existing) {
  const result = {
    projectId
  };
  if (existing) {
    result.existing = true;
  }
  return JSON.stringify(result);
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
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    let query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader('Cache-Control', 'no-cache, no-store');
    // SINGLE component
    if (params.id) {
      query._id = params.id;

      // Return the full set of API-manageable settings so clients can
      // read-modify-write configs (POST replaces each provided config as a whole).
      // Integration settings (jira/tfs/github) stay excluded - they contain credentials.
      const project = await Projects.findOneAsync(query, {fields: PROJECT_API_FIELDS});
      if (project) {
        let result;
        if (request.url.endsWith('/partsList')) {
          let moduleQuery = {projectId: params.id, companyId: keyMetaAndCompany.company._id};
          const modules = await Modules.find(moduleQuery).fetchAsync();
          result = await getPartsListForModules(modules,project);
        } else {
          result = project;
        }
        response.end(JSON.stringify(result));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + params.id));
      }
    } else {
      // Project list
      let projects;
      const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0)*FETCH_LIMIT)
      const options = {limit: FETCH_LIMIT, skip, fields: {name: 1, description: 1}, sort:{name: 1}};
      if(request.query.tags){
        const tags = await Meteor.callAsync('getTagsByCompanyId', query.companyId)
        const mappedTags = request.query.tags.split(',').map(function(tag){return tag.trim();}).map(tag => {
          let hasTag =  tags.find((item)=>{
            return item.name === tag;
          })
          return hasTag && hasTag._id;
        }).filter(tag => tag);
        query.tags = {$in: mappedTags};
      }
      projects = await Projects.find(query, options).fetchAsync();
      if (projects.length === options.limit) {
        // Partial Content,
        // TODO:  this is not conform with spec http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
        //        concerning the mandatory header fields
        response.statusCode = 200;
      }
      response.end(JSON.stringify(projects));
    }
  }
}

async function getPartsListForModules(modules,project) {
  let list = [];
  for (const module of modules) {
    const components = [];
    // Sync getAllComponents() returns null on the Meteor 3 server (its
    // getAnalysis() is null server-side); use the async variant.
    const moduleComponents = await module.getAllComponentsAsync();
    if (moduleComponents && moduleComponents instanceof Array) {
      for (const comp of moduleComponents) {
        let component;
        if(comp.key.indexOf('im:') === 0){
          component = await InfrastructureComponents.findOneAsync({key: comp.key});
        }else{
          component = await Components.findOneAsync({$or:[{key: comp.key}, {oldKey: comp.key}]});
        }
        if (component) {
          components.push(RestApi.mapComponent(comp, component));
        }
      }
    }
    list.push(components)
  }
  let result = _.pick(project, '_id', 'name', 'description');
  result.components = _.unique(_.flatten(list),'name');
  return result
}

//
//    DELETE Requests
//
async function handleDelete(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey( headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager','account_admin', 'portfolio_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    let query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader('Cache-Control', 'no-cache, no-store');
    if (params.id) {
      query._id = params.id;
      const project = await Projects.findOneAsync(query,{fields:{name:1}});
      if (project) {
        const hasModules = await Modules.findOneAsync({projectId: params.id})
        const isForced = params.query && params.query.force && (params.query.force === true || params.query.force === 'true')
        if(!isForced && hasModules){
          response.statusCode = 400;
          response.end(JSON.stringify('Sorry, ensure to delete all associated modules ' +
            'before removing the project or use ?force=true option'));
          return;
        }
        if(hasModules){
          await Modules.removeAsync({projectId: params.id});
          await Meteor.callAsync('logEvent', keyMetaAndCompany.user, `All modules of project ${project.name} deleted`, 'moduleDeleted');
        }
        await Projects.removeAsync(query);
        await Meteor.callAsync('logEvent', keyMetaAndCompany.user, project.name, 'projectDeleted');
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + params.id));
      }
    } else {
      response.statusCode = 400;
      response.end(JSON.stringify('ID is required'));
    }
  }
}

//
//    OPTIONS
//
function handleOptions(request, params, response) {
  //console.log('now in handleOptions');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

// Exported for direct unit testing: handleProjectEnvironmentalContextGet
// (regression lock). This file otherwise has no exports (route handlers are
// module-private, wired up purely as Router.route side effects above).
export {handleProjectEnvironmentalContextGet};

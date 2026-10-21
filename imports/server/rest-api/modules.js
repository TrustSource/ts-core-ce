import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Components from '/imports/lib/collections/components';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import Modules from '/imports/lib/collections/modules';
import RestApi from './RestApi';
import {Meteor} from 'meteor/meteor';
import {helpers} from './apiSchema';
import Utils from '/imports/server/ServerUtils';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';
import {toEnvironmentalContext} from '/imports/lib/converter/environmentalContext';
import {stripResolutionAudit, restoreResolutionAudit}
  from '/imports/lib/licenseResolution/resolutionEntry';
import {safeRequestBody} from './safeRequestBody';

const FETCH_LIMIT = 100;
const RESOURCE_NF = 'Resource not found: '
const SCOPE_LIMITED = 'API-key scope is limited'
const BOM_READ_ROLES = ['manager', 'compliance_manager', 'portfolio_manager', 'company_security_manager'];

Router.route('/api/v2/core/modules', {
  name: 'apiModulesRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModules),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/modules/:id', {
  name: 'apiModuleRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModules),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/modules/:id/partsList', {
  name: 'apiModulePartsListRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModules),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/modules/:id/sbom', {
  name: 'apiModuleSbomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModules),
  trackPageView: false                // don't report page changes to google analytics
});

// Dedicated AIBOM (AI/ML-BOM) and CBOM (Cryptography-BOM) request endpoints. GET serializes
// the module's BOM as CycloneDX 1.7 (variant-filtered). Publishing an AIBOM/CBOM uses the
// same mechanism as the SBOM - POST the CycloneDX document to /api/v2/core/imports/scan/cyclonedx
// (or /api/v2/core/scans); the reader extracts machine-learning-model -> aiProperties and
// cryptographic-asset -> cryptoProperties, so no dedicated publish endpoint is needed.
Router.route('/api/v2/core/modules/:id/aibom', {
  name: 'apiModuleAibomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModuleBom),
  trackPageView: false
});

Router.route('/api/v2/core/modules/:id/cbom', {
  name: 'apiModuleCbomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModuleBom),
  trackPageView: false
});

// Environmental (iCVSS) context: GET returns the module's stored
// CR/IR/AR requirements plus its CVSS environmental vector strings and the
// best-effort MAV parsed from them. Read-only; mirrors getModuleBom's auth/CORS.
Router.route('/api/v2/core/modules/:id/environmental-context', {
  name: 'apiModuleEnvironmentalContextRoute',
  where: 'server',
  action: RestApi.wrapAsync(getModuleEnvironmentalContext),
  trackPageView: false
});

async function getModules() {
  RestApi.requestLogger(this.request, this.params, 'modules');
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
  }  else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}
function bomVariantFromUrl(url) {
  if (!url) return undefined;
  if (url.indexOf('/aibom') !== -1) return 'AIBOM';
  if (url.indexOf('/cbom') !== -1) return 'CBOM';
  return undefined;
}

async function getModuleBom() {
  RestApi.requestLogger(this.request, this.params, 'modules');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  const variant = bomVariantFromUrl(this.request.url);

  if (this.request.method === 'GET') {
    await handleBomGet(this.request, this.params, this.response, variant);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

// GET /api/v2/core/modules/:id/{aibom|cbom} - serialize the module's BOM as CycloneDX 1.7,
// filtered to the requested variant (AIBOM = machine-learning-model assets, CBOM = crypto).
async function handleBomGet(request, params, response, variant) {
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
  const module = await Modules.findOneAsync({_id: params.id, companyId}, {fields: {projectId: 1}});
  if (!module) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  const report = await Meteor.callAsync('getProjectSBOM', module.projectId, companyId, params.id);
  const doc = reportSbomFileService.getCycloneDxDetails(report, variant);
  response.end(JSON.stringify(doc));
}

// GET/OPTIONS dispatch for the environmental-context route; mirrors
// getModuleBom's auth/CORS/version/OPTIONS shape. Only GET + OPTIONS are allowed.
async function getModuleEnvironmentalContext() {
  RestApi.requestLogger(this.request, this.params, 'modules');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleEnvironmentalContextGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

// GET /api/v2/core/modules/:id/environmental-context - the module's CVSS environmental
// context. companyId is taken ONLY from the API key (never the body/query/path),
// so a foreign module id resolves to 404, not another tenant's data.
async function handleEnvironmentalContextGet(request, params, response) {
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
  const module = await Modules.findOneAsync({_id: params.id, companyId},
    {fields: {name: 1, projectId: 1, ciaRequirements: 1, environmentalConfig: 1}});
  if (!module) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  response.end(JSON.stringify(toEnvironmentalContext(module)));
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

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  // Strip MongoDB operators from body before merging.
  //
  // safeRequestBody, not an inline copy loop: a body whose own `__proto__` key
  // JSON.parse produced turns `safeBody[key] = value` into a prototype
  // reassignment, so every hasOwnProperty guard below answers false while
  // _.extend - which copies INHERITED keys - writes the payload anyway. That is
  // exactly how the audit-trail strip below was bypassed. See ./safeRequestBody.
  const safeBody = safeRequestBody(body);
  const companyId = keyMetaAndCompany.company._id;
  if(!params.id){
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  // Scope the lookup AND the update to the caller's company. Without this, one
  // tenant's API key could read, hijack (reassign companyId), and then delete
  // another tenant's module by guessing its id.
  //
  // The projection stays NARROW. Whatever it carries ends up in `$set: module`
  // below, so projecting componentConfig here would write a componentConfig
  // holding only the projected sub-field and wipe whitelist/blacklist/unchanged/
  // looseCoupled with it whenever the caller supplies no componentConfig at all.
  const current = await Modules.findOneAsync({_id: params.id, companyId},{fields:{name:1, moduleIdentifier:1}});
  if(!current){
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  // The manual-license-resolution audit trail is not FORGEABLE from
  // here. It is still REPLACEABLE, because this endpoint replaces each config as
  // a whole: a body that omits `licensesSelected`, or omits one entry, or repeats
  // an entry under a different license, still drops the stored resolution - with
  // no logEvent. That is the pre-existing replace-whole-config contract, which
  // destroys whitelist/blacklist/unchanged/looseCoupled the same way; closing it
  // belongs with the updateCollection role-check ticket, not here. Do not read
  // the strip below as making this endpoint safe for the audit trail generally.
  //
  // `justification`/`resolvedBy`/`resolvedById`/`resolvedAt` say WHO determined a
  // component's license, WHEN, and on what written grounds, and the method that
  // writes them is gated on compliance_manager|manager. Declaring them on
  // SelectedLicensesEntrySchema is what made them reachable from here: `filter`
  // defaults to true in the vendored simple-schema, so until they were declared
  // cleanAndValidateModule dropped them and the `$set: module` below could not
  // carry them. This endpoint is gated on API-key scope ['developer','manager'] -
  // the LOWEST scope in the product, and validateKeyScope returns true
  // unconditionally for a key with no scope array - so without the strip an
  // integration key forges an authoritative audit record ("Set by Jane Doe, Head
  // of Legal") and steers any component's license past the role gate.
  //
  // The RESTORE is the other half, and it is not optional either: handleGet
  // returns these four fields and this endpoint documents read-modify-write, so
  // stripping alone would let an ordinary round trip silently convert every
  // resolution in the module into a plain entry - killing the injection, the
  // panel and undo, and orphaning the LIC risk, with no logEvent.
  if (Object.prototype.hasOwnProperty.call(safeBody, 'componentConfig')) {
    const supplied = safeBody.componentConfig;
    let cleaned = stripResolutionAudit(supplied);
    if (cleaned && Array.isArray(cleaned.licensesSelected)) {
      const resolutions = await Modules.findOneAsync({_id: params.id, companyId},
        {fields: {'componentConfig.licensesSelected': 1}});
      cleaned = restoreResolutionAudit(cleaned,
        ((resolutions || {}).componentConfig || {}).licensesSelected);
    }
    safeBody.componentConfig = cleaned;
  }
  let module = _.extend(safeBody, {
    companyId: companyId
  });
  module = _.extend(current, module);
  const context = helpers.cleanAndValidateModule(module);
  if (context.isValid() && params.id) {
    try {
      const count = await Modules.updateAsync({_id: params.id, companyId},{$set: module});
      if(count === 1){
        const current = await Modules.findOneAsync(params.id);
        response.statusCode = 200;
        response.end(JSON.stringify(current));
      }
    }catch (e) {
      response.statusCode = 400;
      const respStr = {error: e.toString()};
      console.log('Error updating module: ', respStr);
      response.end(respStr);
    }
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error creating/updating module: ', respStr);
    response.end(respStr);
  }
}
//
//    GET Requests
//
async function handleGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
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
      const module = await Modules.findOneAsync(query,{fields:{
        name:1, description:1, status:1, projectId:1,
        version:1, moduleIdentifier:1, tags:1, confidenceMinScore:1,
        licenseConfig:1, componentConfig:1, viabilityConfig:1,
        versioningConfig:1, cveConfig:1, obligationConfig:1, legalRulesConfig:1,
        requirements:1, ciaRequirements:1, properties:1,
        environmentalConfig:1, endoflifePolicy:1, customComponents:1
      }});
      if (module) {
        let filter = {
          companyId: module.companyId,
          moduleId: module._id
        };
        let options = {sort: {'date': -1}, fields:{statistics:1,date:1,_id:1,scanId:1}};
        module.analysis = await Meteor.callAsync('findOneModuleAnalysis', filter, options)
        let result;
        if (request.url.endsWith('/partsList')) {
          result = await getPartsListForModule(module);
        } else if (request.url.endsWith('/sbom')) {
          result = await Meteor.callAsync('getProjectSBOM',module.projectId, keyMetaAndCompany.company._id, params.id)
        }  else {
          result = module;
        }
        response.end(JSON.stringify(result));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + params.id));
      }
    } else {
      // Module list
      let modules;
      const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0)*FETCH_LIMIT)
      const options = {limit: FETCH_LIMIT, skip, fields: {name: 1, description: 1}, sort:{name: 1}};
      if(request.query.projectId){
        query.projectId = request.query.projectId;
      }
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
      modules = await Modules.find(query, options).fetchAsync();
      if (modules.length === options.limit) {
        // Partial Content,
        // TODO:  this is not conform with spec http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
        //        concerning the mandatory header fields
        response.statusCode = 200;
      }
      response.end(JSON.stringify(modules));
    }
  }
}

async function getPartsListForModule(module) {
  const result = _.pick(module, '_id', 'name', 'status');
  const components = [];
  // getAllComponents() is synchronous and resolves the analysis via the sync
  // getAnalysis(), which returns null on the Meteor 3 server - so it yielded an
  // empty parts list. Use the server-safe async variant.
  const moduleComponents = await module.getAllComponentsAsync();
  const analysis = await module.getAnalysisAsync();

  result.lastAnalysis = analysis && analysis.date || '';
  result.components = components;
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
  return result;
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
      const module = await Modules.findOneAsync(query,{fields:{name:1}});
      if (module) {
        await Modules.removeAsync(query);
        await Meteor.callAsync('logEvent', keyMetaAndCompany.user, module.name, 'moduleDeleted');
        await Meteor.callAsync('updateCompanyStatistics', keyMetaAndCompany.user);
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + params.id));
      }
    } else {
      response.statusCode = 405;
      response.end(JSON.stringify('Method Not Allowed'));
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

// Exported for direct unit testing / regression-locking of the
// environmental-context GET handler (this file otherwise wires handlers up
// purely as Router.route side effects).
export {handleEnvironmentalContextGet};

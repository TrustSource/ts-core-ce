import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Approves from '/imports/lib/collections/approves';
import Modules from '/imports/lib/collections/modules';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import Scans from '/imports/lib/collections/scans';
import Utils from '/imports/server/ServerUtils';
import RestApi from './RestApi';
import {helpers} from './apiSchema';
import {APPROVAL_CREATE_ROLES} from '/imports/lib/interactors/approves/create';

Router.route('/api/v2/compliance/approvals', {
  name: 'apiApprovesInitiateRoute',
  where: 'server',
  action: RestApi.wrapAsync(initiateApprove),
  trackPageView: false
});

Router.route('/api/v2/compliance/approvals/:id', {
  name: 'apiApproveRoute',
  where: 'server',
  action: RestApi.wrapAsync(getInformationByApprove),
  trackPageView: false
});

Router.route('/api/v2/compliance/approvals/:id/approve', {
  name: 'apiApprovalApproveRoute',
  where: 'server',
  action: RestApi.wrapAsync(actionsByApprove),
  trackPageView: false
});

Router.route('/api/v2/compliance/approvals/:id/reject', {
  name: 'apiApprovalRejectRoute',
  where: 'server',
  action: RestApi.wrapAsync(actionsByApprove),
  trackPageView: false
});

const RESOURCE_NF = 'Resource not found: '
const METHOD_NA = 'Method Not Allowed'
const NO_CACHE = 'no-cache, no-store'
const CONTENT_TYPE = 'Content-Type'
const APP_JSON = 'application/json'
const CACHE_CONTROL = 'Cache-Control'
const SCOPE_LIMITED = 'API-key scope is limited'

async function initiateApprove() {
  RestApi.requestLogger(this.request, this.params, 'approval/initiate');
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
   
  this.response.setHeader('Access-Control-Allow-Origin', '*');
   
  this.response.setHeader('Access-Control-Allow-Methods', '*');
   
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await handlePost(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getInformationByApprove() {
  RestApi.requestLogger(this.request, this.params, 'approval/:id');
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

async function actionsByApprove() {
  RestApi.requestLogger(this.request, this.params, 'approval/:id/actions');
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    await handleApprovalActions(this.request, this.params, this.response);
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
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    const query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader(CACHE_CONTROL, NO_CACHE);
    if (params.id) {
      query._id = params.id;

      const approve = await Approves.findOneAsync(query);
      if(approve){
        let {_id, name, created, initiatorName, binaryLinks, draft} = approve;
        let result = {
          _id, name, created, initiatorName, draft
        };
        if(binaryLinks){
          result.binaryLinks = _.map(binaryLinks,function (link) {
            return {
              name: link.name,
              comment: link.comment,
              userName: link.userName
            };
          });
        }
        if(approve.moduleId){
          result.url = Meteor.absoluteUrl('projects/'+approve.projectId+'/modules/'+approve.moduleId+'/dependencies');
        }else{
          result.url = Meteor.absoluteUrl('projects/'+approve.projectId);
        }
        if(approve.noticeFileId){
          result.noticeFile = approve.getStats('notice');
        }
        response.end(JSON.stringify(result));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify('Approve not found: ' + params.id));
      }
    }
  }
}
//
//    POST
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

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, APPROVAL_CREATE_ROLES)){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }
  const context = helpers.cleanAndValidateApprovesInitiate(body);
  if (context.isValid()) {
    const companyId = keyMetaAndCompany.company._id;
    // Scope the scan/analysis lookups to the caller's company: previously a
    // tenant could read another tenant's scan (moduleId) and analysis by id
    // before the module ownership check below.
    let scan = await Scans.findOneAsync({_id: body.scanId, companyId}, {sort: {'date': -1}, fields: {
      moduleId: 1
    }})
    if (!scan) {
      response.statusCode = 404;
      response.end(JSON.stringify({error: RESOURCE_NF + body.scanId}));
      return;
    }
    let analysis = await ModuleAnalysis.findOneAsync({scanId: body.scanId, companyId}, {sort: {'date': -1}})
    let moduleId = scan.moduleId;
    let {_id, date, tag, branch, release, binaryLinks} = analysis || {}
    const module = await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {
      version: 1, projectId: 1
    }});
    if (!module) {
      response.statusCode = 404;
      response.end(JSON.stringify({error: RESOURCE_NF + moduleId}));
      return;
    }
    const approve = {
      name: body.name,
      version: body.version,
      description: body.description,
      projectId: module.projectId,
      moduleId: moduleId,
      modules: [{
        _id: moduleId,
        date: date || null,
        scanId: body.scanId,
        analysisId: _id,
        branch: branch || null,
        tag: tag || null,
        release: release || null,
        binaryLinks: binaryLinks || null,
        version: module.version || null
      }],
      draft: body.draft,
      demo: body.demo,
      apiUser: keyMetaAndCompany.user
    };
    let lastId = await Meteor.callAsync('Approves.Create', approve);
    response.statusCode = 201;
    response.end(createOKResponse(lastId));
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error processing approval: ', respStr);
    response.end(respStr);
  }
}
async function handleApprovalActions(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['compliance_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  const query = {
    companyId: keyMetaAndCompany.company._id,
    _id: params.id
  };
  const approve = await Approves.findOneAsync(query);
  if(approve){
    let actionType = request.url.split('/').pop()
    let lastId;
    switch (actionType) {
    case 'approve' : {
      lastId = await Meteor.callAsync('Approves.Approve', approve._id, keyMetaAndCompany.user);
      break;
    }
    case 'reject' : {
      if(!body.reason){
        response.statusCode = 400;
        response.end(JSON.stringify('"reason" is required for /reject action'));
        return;
      }
      lastId = await Meteor.callAsync('Approves.Reject', approve._id, body.reason, keyMetaAndCompany.user);
      break;
    }
    default: {
      response.statusCode = 405;
      response.end(JSON.stringify('Method is not allowed'));
    }
    }
    if(lastId){
      response.statusCode = 200;
      response.end(JSON.stringify({updated: lastId}));
    }
  }else{
    response.statusCode = 404;
    response.end(JSON.stringify({error: RESOURCE_NF + params.id}));
  }
}

function createOKResponse(approveId) {
  const result = {
    approveId: approveId
  };
  return JSON.stringify(result);
}

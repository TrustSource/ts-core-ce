import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import reportVulnerabilityService from '/imports/lib/reports/reportVulnerabilityService';
import reportVersioningService from '/imports/lib/reports/reportVersioningService';
import reportLicensesService from '/imports/lib/reports/reportLicensesService';
import reportCveService from '/imports/lib/reports/reportCveService';
import reportViabilityService from '/imports/lib/reports/reportViabilityService';
import reportEndoflifeService from '/imports/lib/reports/reportEndoflifeService';
import reportBadAlgorithmsService from '/imports/lib/reports/reportBadAlgorithmsService';
import RestApi from './RestApi';
import LogEvents from '/imports/lib/collections/logevents';
import Utils from '/imports/server/ServerUtils';

const RESOURCE_NF = 'Resource not found: '
const METHOD_NA = 'Method Not Allowed'
const NO_CACHE = 'no-cache, no-store'
const CONTENT_TYPE = 'Content-Type'
const APP_JSON = 'application/json'
const CACHE_CONTROL = 'Cache-Control'
const SCOPE_LIMITED = 'API-key scope is limited'
const BAD_REQUEST = 'Bad Request'

// The project report a request asks for is the last segment of its path. v2 spells it
// out (/api/v2/core/reports/vulnerabilities); handleGet reads the short type from
// 'reports/<type>'. Any other segment is used as it is.
const PROJECT_REPORT_TYPES = {vulnerabilities: 'vul', versioning: 'ver', viability: 'via', licenses: 'lic'};

function reportLabel(url) {
  const segment = String(url || '').split('?')[0].split('/').filter(Boolean).pop() || '';
  return 'reports/' + (PROJECT_REPORT_TYPES[segment] || segment);
}

Router.route('/api/v2/core/reports/vulnerabilities', {
  name: 'apiReportsVulRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/versioning', {
  name: 'apiReportsVerRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/viability', {
  name: 'apiReportsViaRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/licenses', {
  name: 'apiReportsLicRoute',
  where: 'server',
  action: RestApi.wrapAsync(getProjectReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/cve', {
  name: 'apiReportsCveRoute',
  where: 'server',
  action: RestApi.wrapAsync(getCveReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/algorithms', {
  name: 'apiReportsAlgorithmsRoute',
  where: 'server',
  action: RestApi.wrapAsync(getAlgorithmsReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/endoflife', {
  name: 'apiReportsEndoflifeRoute',
  where: 'server',
  action: RestApi.wrapAsync(getEndoflifeReport),
  trackPageView: false
});

Router.route('/api/v2/core/reports/dashboard', {
  name: 'apiReportsDashboardRoute',
  where: 'server',
  action: RestApi.wrapAsync(getDashboardReport),
  trackPageView: false
});

async function getProjectReport() {
  let reportType = reportLabel(this.request.url);
  RestApi.requestLogger(this.request, this.params, reportType);
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
   
  this.response.setHeader('Access-Control-Allow-Origin', '*');
   
  this.response.setHeader('Access-Control-Allow-Methods', '*');
   
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleGet(this.request, this.params, this.response, reportType);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getAlgorithmsReport() {
  let reportType = reportLabel(this.request.url);
  RestApi.requestLogger(this.request, this.params, reportType);
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleAlgorithmsGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getEndoflifeReport() {
  let reportType = reportLabel(this.request.url);
  RestApi.requestLogger(this.request, this.params, reportType);
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleEndoflifeGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getCveReport() {
  let reportType = reportLabel(this.request.url);
  RestApi.requestLogger(this.request, this.params, reportType);
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleCveGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

async function getDashboardReport() {
  let reportType = reportLabel(this.request.url);
  RestApi.requestLogger(this.request, this.params, reportType);
  this.response.statusCode = 200;
  this.response.setHeader(CONTENT_TYPE, APP_JSON);
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    await handleDashboardGet(this.request, this.params, this.response);
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify(METHOD_NA));
  }
}

//
//    GET Requests
//
async function handleGet(request, params, response, partUrl) {
  let reportType = partUrl.slice(8);
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    response.setHeader(CACHE_CONTROL, NO_CACHE);
    const projectId = params.query.projectId;
    const minConfidence = params.query.minConfidence ? +params.query.minConfidence : null;
    if (projectId) {
      let result;
      let reportData;
      switch (reportType) {
      case 'vul' : {
        if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
          'company_security_manager', 'company_component_manager'])){
          response.statusCode = 403;
          response.end(JSON.stringify(SCOPE_LIMITED));
          return;
        }
        reportData = await Meteor.callAsync('getProjectVulnerability', projectId, keyMetaAndCompany.company._id, null, null, minConfidence);
        if (reportData.project) {
          result = reportVulnerabilityService.getJsonDetails(reportData);
        } else {
          response.statusCode = 404;
          result = RESOURCE_NF + projectId;
        }
        break;
      }
      case 'ver' : {
        if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
          'company_security_manager', 'company_component_manager'])){
          response.statusCode = 403;
          response.end(JSON.stringify(SCOPE_LIMITED));
          return;
        }
        reportData = await Meteor.callAsync('getProjectVersioning', projectId, keyMetaAndCompany.company._id);
        if (reportData.project) {
          result = reportVersioningService.getJsonDetails(reportData);
        } else {
          response.statusCode = 404;
          result = RESOURCE_NF + projectId;
        }
        break;
      }
      case 'via' : {
        if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
          'company_security_manager', 'company_component_manager'])){
          response.statusCode = 403;
          response.end(JSON.stringify(SCOPE_LIMITED));
          return;
        }
        reportData = await Meteor.callAsync('getProjectViability', projectId, keyMetaAndCompany.company._id);
        if (reportData.project) {
          result = reportViabilityService.getJsonDetails(reportData);
        } else {
          response.statusCode = 404;
          result = RESOURCE_NF + projectId;
        }
        break;
      }
      case 'lic' : {
        if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager'])){
          response.statusCode = 403;
          response.end(JSON.stringify(SCOPE_LIMITED));
          return;
        }
        reportData = await Meteor.callAsync('getProjectLicenses', projectId, keyMetaAndCompany.company._id);
        if (reportData.project) {
          result = reportLicensesService.getJsonDetails(reportData);
        } else {
          response.statusCode = 404;
          result = RESOURCE_NF + projectId;
        }
        break;
      }
      default: {
        response.statusCode = 404;
        result = RESOURCE_NF + projectId;
      }
      }
      response.end(JSON.stringify(result));
    } else {
      response.statusCode = 400;
      response.end(JSON.stringify(projectIdRequiredError()));
    }
  }
}

function projectIdRequiredError() {
  return {
    'error': BAD_REQUEST,
    'object': 'Report:',
    'messages': [
      {
        'message': 'Project id is required',
        'details': {
          'name': 'projectId',
          'type': 'required',
          'value': null
        }
      }
    ]
  };
}

async function handleCveGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager', 'company_component_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    response.setHeader(CACHE_CONTROL, NO_CACHE);
    const cveKey = params.query.cveId;
    if (cveKey) {
      let result;
      let reportData;
      reportData = await Meteor.callAsync('getImpactCve', cveKey.toUpperCase(), keyMetaAndCompany.company._id);
      if (reportData.cveDetails) {
        result = reportCveService.getJsonDetails(reportData);
      } else {
        response.statusCode = 404;
        result = RESOURCE_NF + cveKey;
      }
      response.end(JSON.stringify(result));
    } else {
      response.statusCode = 400;
      response.end(JSON.stringify({
        'error': BAD_REQUEST,
        'object': 'Report:',
        'messages': [
          {
            'message': 'CVE is required',
            'details': {
              'name': 'cveId',
              'type': 'required',
              'value': null
            }
          }
        ]
      }));
    }
  }
}

async function handleAlgorithmsGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    response.setHeader(CACHE_CONTROL, NO_CACHE);
    const projectId = params.query.projectId;
    let result;
    let reportData;
    reportData = await Meteor.callAsync('getProjectBadAlgorithms', projectId, keyMetaAndCompany.company._id, keyMetaAndCompany.user);
    if (reportData.list) {
      result = reportBadAlgorithmsService.getJsonDetails(reportData);
    } else {
      response.statusCode = 404;
      result = RESOURCE_NF;
    }
    response.end(JSON.stringify(result));
  }
}

async function handleEndoflifeGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['compliance_manager', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    response.setHeader(CACHE_CONTROL, NO_CACHE);
    const projectId = params.query.projectId;
    // Required, as documented: without it the report ran over no project.
    if (typeof projectId !== 'string' || !projectId) {
      response.statusCode = 400;
      response.end(JSON.stringify(projectIdRequiredError()));
      return;
    }
    let result;
    let reportData;
    reportData = await Meteor.callAsync('getProjectEndoflife', projectId, keyMetaAndCompany.company._id, keyMetaAndCompany.user);
    if (reportData.list) {
      result = reportEndoflifeService.getJsonDetails(reportData);
    } else {
      response.statusCode = 404;
      result = RESOURCE_NF;
    }
    response.end(JSON.stringify(result));
  }
}

async function handleDashboardGet(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager', 'company_component_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    try {
      let moduleHistory = await Meteor.callAsync('getModulesHistory', keyMetaAndCompany.company._id);
      let total = await Meteor.callAsync('getTotalLicensesAndComponents', keyMetaAndCompany.company._id);
      let componentsLicenses = await Meteor.callAsync('getLicenseStatistics', null, null, null, keyMetaAndCompany.company._id, true);
      let moduleStats = await Meteor.callAsync('getModulesChartData', keyMetaAndCompany.company._id, true);
      let activityLogs = await LogEvents.find({companyId: keyMetaAndCompany.company._id}, {sort: {date: -1}, limit: 10}).fetchAsync();
      response.setHeader(CACHE_CONTROL, NO_CACHE);
      response.statusCode = 200;
      response.end(JSON.stringify({
        activityLogs,
        componentsLicenses,
        moduleStats,
        moduleHistory: moduleHistory && moduleHistory.history,
        total
      }));
    } catch (e) {
      response.statusCode = 400;
      response.end(JSON.stringify(e.toString()));
    }
  }
}

//
//    OPTIONS
//
function handleOptions(request, params, response) {
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

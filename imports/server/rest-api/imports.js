import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';
import RestApiScans from './scans';
import ImportConverter from './ImportConverter';
import {helpers} from './apiSchema';
import Utils from '/imports/server/ServerUtils';

const ERROR_TITLE = 'Error processing import: '

Router.route('/api/v2/core/imports/scan/cyclonedx', {
  name: 'apiImportsScanCyclonedxRoute',
  where: 'server',
  action: RestApi.wrapAsync(importScanCyclonedx),
  trackPageView: false
});

Router.route('/api/v2/core/imports/scan/cyclonedx/json', {
  name: 'apiImportsScanCyclonedxJsonRoute',
  where: 'server',
  action: RestApi.wrapAsync(importScanCyclonedx),
  trackPageView: false,
  onBeforeAction: RestApi.parseFile
});

Router.route('/api/v2/core/imports/scan/spdx', {
  name: 'apiImportsScanSpdxRoute',
  where: 'server',
  action: RestApi.wrapAsync(importScanSpdx),
  trackPageView: false
});

Router.route('/api/v2/core/imports/scan/spdx/:format', {
  name: 'apiImportsScanSpdxJsonRoute',
  where: 'server',
  action: RestApi.wrapAsync(importScanSpdx),
  trackPageView: false,
  onBeforeAction: RestApi.parseFile
});

async function importScanCyclonedx() {
  await importScan('cyclonedx', this.request, this.params, this.response)
}

async function importScanSpdx() {
  await importScan('spdx', this.request, this.params, this.response)
}

async function importScan(type, request, params, response) {
  RestApi.requestLogger(request, params, `imports/scan/${type}`);
  response.statusCode = 200;   // default OK
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers',
    'Content-Length,Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
  if (request.method === 'POST') {
    await handlePost(type, request, params, response);
  } else if (request.method === 'OPTIONS') {
    handleOptions(response);
  } else {
    response.statusCode = 405;
    response.end(JSON.stringify('Method Not Allowed'));
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

// `moduleName`/`projectName` are the canonical parameter names across the ingest
// endpoints; `module`/`project` - what this endpoint has always called them -
// stay accepted, so a client can spell them one way everywhere. Mutates the live query
// object because ImportConverter reads it too.
function applyNameAliases(query) {
  if (!query.module && typeof query.moduleName === 'string') {
    query.module = query.moduleName;
  }
  if (!query.project && typeof query.projectName === 'string') {
    query.project = query.projectName;
  }
}

//
//    POST Requests
//
async function handlePost(type, request, requestParams, response) {
  const body = request.body;
  const params = requestParams;

  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {

    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
      'company_security_manager', 'company_component_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify('API-key scope is limited'));
      return;
    }
    response.setHeader('Cache-Control', 'no-cache, no-store');
    if(!params.query){ params.query = {} }
    applyNameAliases(params.query);
    const context = helpers.cleanAndValidateImport(type, body, params);
    const contextParams = helpers.cleanAndValidateImportParams(Object.assign({}, params.query));
    if (context.isValid() && contextParams.isValid()) {
      try {
        let scanBody = ImportConverter.toScan(type, body, params)
        delete scanBody.moduleIdentifier
        request.headers['user-agent'] = `import-${type}/1.0.0`
        const headers = request.headers || {};
        await RestApiScans.handlePost({body: scanBody, headers}, params, response)
      } catch (e) {
        response.statusCode = 400;
        response.end(JSON.stringify({
          error: 'Bad Request',
          object: {
            error: e.toString()
          },
          messages: [e.toString()]
        }));
      }
    } else if (!context.isValid()) {
      response.statusCode = 400;
      const respStr = RestApi.createErrorResponse(context);
      console.log(ERROR_TITLE, respStr);
      response.end(respStr);
    } else if (!contextParams.isValid()) {
      response.statusCode = 400;
      const respStr = RestApi.createErrorResponse(contextParams);
      console.log(ERROR_TITLE, respStr);
      response.end(respStr);
    }
  }
}


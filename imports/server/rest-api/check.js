import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import Components from '/imports/lib/collections/components';
import Companies from '/imports/lib/collections/companies';
import Utils from '/imports/server/ServerUtils';
import RestApi from './RestApi';
import {findProjectByName} from './projectResolver';
import LicensesService from '/imports/api/licenses';
import {checkComponentForCompany} from '/imports/server/collections/modules';

const COMPLETE_LEGAL = 'Please complete legal requirements first'
const SETTINGS_INCOMPLETE = '" can not be checked, because settings are incomplete. '

Router.route('/api/v2/compliance/check/license', {
  name: 'apiCheckLicenseRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleCheckLicense),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/compliance/check/component', {
  name: 'apiCheckComponentRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleCheckComponent),
  trackPageView: false                // don't report page changes to google analytics
});

async function handleCheckLicense() {
  const request = this.request;
  const response = this.response;
  const params = this.params;

  RestApi.requestLogger(request, params, 'check_license');
  response.statusCode = 200;   // default OK
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
   
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
    'company_security_manager', 'company_component_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify('API-key scope is limited'));
    return;
  }

  if (request.method === 'POST') {
    await handleLicense(request, response, keyMetaAndCompany);
  } else if (request.method === 'OPTIONS') {
    handleOptions(request, response);
  } else {
    response.statusCode = 405;
    response.end('Method Not Allowed');
  }
}

 
async function handleLicense(request, response, keyMetaAndCompany) {
  if (!request.body) {
    response.statusCode = 400;
    response.end('Bad Request');
    return;
  }

  const body = request.body;
  const companyId = keyMetaAndCompany && keyMetaAndCompany.company && keyMetaAndCompany.company._id;
  // Ensure name fields are strings to prevent MongoDB operator injection
  const projectName = typeof body.projectName === 'string' ? body.projectName : '';
  const moduleName = typeof body.moduleName === 'string' ? body.moduleName : '';
  // Shared with the ingest endpoints: the same name has to answer the same
  // project here as it does for a scan or a SARIF upload.
  const project = await findProjectByName({companyId, name: projectName});
  if(project){
    if(!project.legalSettingsValid()){
      response.statusCode = 400;
      response.end(JSON.stringify({error: 'Sorry, project "'+projectName+SETTINGS_INCOMPLETE +
      COMPLETE_LEGAL}));
      return
    }
    const module = await Modules.findOneAsync({companyId, name: moduleName, projectId: project._id});
    if(module){
      if(!module.legalSettingsValid()){
        response.statusCode = 400;
        response.end(JSON.stringify({error: 'Sorry, module "'+moduleName+SETTINGS_INCOMPLETE +
        COMPLETE_LEGAL}));
        return
      }
      let warnings = [];
      let licenses = [];
      _.each(body.licenses, function (licenseName) {
        let licenseFound = LicensesService.find(licenseName);
        if(licenseFound){
          licenses.push(licenseFound);
        }else{
          warnings.push({
            component: licenseName,
            status: 'license_not_found'
          })
        }
      });
      if(licenses.length > 0){
        let list = [];
        _.each(licenses, function (license) {
          list.push(license.key);
        });
        try {
          const data = await Meteor.callAsync('checkLicense', project._id, module._id, list);
          const company = await Companies.findOneAsync(module.companyId);
          if(company){
            const mappedData = _.map(data,function (oneResult) {
              oneResult.changed.computedStatus = Utils.computedLicenseStatusDetails(module, project, company,
                oneResult.licenseKey, oneResult.changed);
              oneResult.not_changed.computedStatus = Utils.computedLicenseStatusDetails(module, project, company,
                oneResult.licenseKey, oneResult.not_changed);
              if(oneResult.changed.obligations){
                oneResult.changed.obligations = _.map(oneResult.changed.obligations.split('; '),function (obligation) {
                  let details = Utils.translateObligations(obligation);
                  return {
                    type: 'obligation',
                    message: (details && details.description) || obligation
                  }
                });
              }else{
                oneResult.changed.obligations = [];
              }
              if(oneResult.changed.violations){
                oneResult.changed.violations = _.map(oneResult.changed.violations.split('; '),function (violation) {
                  let details = Utils.translatePermitions(violation);
                  return {
                    type: (details && details.type) || 'violation',
                    message: (details && details.message) || violation
                  }
                });
              }else{
                oneResult.changed.violations = [];
              }
              if(oneResult.not_changed.obligations){
                oneResult.not_changed.obligations = _.map(oneResult.not_changed.obligations.split('; '),function (obligation) {
                  let details = Utils.translateObligations(obligation);
                  return {
                    type: 'obligation',
                    message: (details && details.description) || obligation
                  }
                });
              }else{
                oneResult.not_changed.obligations = [];
              }
              if(oneResult.not_changed.violations){
                oneResult.not_changed.violations = _.map(oneResult.not_changed.violations.split('; '),function (violation) {
                  let details = Utils.translatePermitions(violation);
                  return {
                    type: (details && details.type) || 'violation',
                    message: (details && details.message) || violation
                  }
                });
              }else{
                oneResult.not_changed.violations = [];
              }
              delete oneResult.changed.status;
              delete oneResult.not_changed.status;
              return oneResult
            });
            response.end(JSON.stringify({ok: warnings.length <= 0, warnings, data: mappedData}));
          }
        } catch(error) {
          response.statusCode = 400;
          response.end(JSON.stringify({error}));
        }
      }else{
        response.statusCode = 404;
        response.end(JSON.stringify({error: 'Licenses not found'}));
      }
    }else{
      response.statusCode = 404;
      response.end(JSON.stringify({error: 'Module "'+ moduleName +'" not found in project "'+projectName+'"'}));
    }
  }else{
    response.statusCode = 404;
    response.end(JSON.stringify({error: 'Project "'+ projectName +'" not found'}));
  }
}

async function handleCheckComponent() {
  const request = this.request;
  const response = this.response;
  const params = this.params;

  RestApi.requestLogger(request, params, 'check_component');
  response.statusCode = 200;   // default OK
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');


  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'compliance_manager', 'portfolio_manager',
    'company_security_manager', 'company_component_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify('API-key scope is limited'));
    return;
  }

  if (request.method === 'POST') {
    await handleComponent(request, response, keyMetaAndCompany);
  } else if (request.method === 'OPTIONS') {
    handleOptions(request, response);
  } else {
    response.statusCode = 405;
    response.end('Method Not Allowed');
  }
}

 
async function handleComponent(request, response, keyMetaAndCompany) {
  if (!request.body) {
    response.statusCode = 400;
    response.end('Bad Request');
    return;
  }

  const body = request.body;
  const companyId = keyMetaAndCompany && keyMetaAndCompany.company && keyMetaAndCompany.company._id;
  // Ensure name fields are strings to prevent MongoDB operator injection
  const projectName = typeof body.projectName === 'string' ? body.projectName : '';
  const moduleName = typeof body.moduleName === 'string' ? body.moduleName : '';
  // Shared with the ingest endpoints: the same name has to answer the same
  // project here as it does for a scan or a SARIF upload.
  const project = await findProjectByName({companyId, name: projectName});
  if(project){
    if(!project.legalSettingsValid()){
      response.statusCode = 400;
      response.end(JSON.stringify({error: 'Sorry, project "'+projectName+SETTINGS_INCOMPLETE +
      COMPLETE_LEGAL}));
      return
    }
    const module = await Modules.findOneAsync({companyId, name: moduleName, projectId: project._id});
    if(module){
      if(!module.legalSettingsValid()){
        response.statusCode = 400;
        response.end(JSON.stringify({error: 'Sorry, module "'+moduleName+SETTINGS_INCOMPLETE +
        COMPLETE_LEGAL}));
        return
      }
      let warnings = [];
      let components = [];
      for (const component of body.components) {
        let componentFound = await Components.findOneAsync({$or:[{name: component.key},{key: component.key}]});
        if(componentFound){
          components.push({
            component: componentFound,
            version: component.version
          });
        }else{
          warnings.push({
            component: component.key,
            status: 'component_not_found'
          })
        }
      }
      if(components.length > 0){
        let list = [];
        _.map(components, function (componentItem) {
          let component = componentItem.component;
          const version = component && component.getVersions().find(function (versionItem) {
            return versionItem.getVersion() === componentItem.version
          });
          if(version){
            if(version.getLicense()){
              let licenses = _.map(version.getLicenses(component.getDeclaredLicenses()),function (license) {
                return {
                  'name':license.getKey()
                }
              });
              let componentObject = {
                'name' : component.getName(),
                'key' : component.getKey(),
                'homepageUrl' : component.getUrl('homepage') || null,
                'repoUrl' : component.getUrl('repo') || null,
                'dependencies' : [],
                'licenses' : licenses[0] ? [licenses[0]] : [],
                'versions' : [version.getVersion()]
              };
              list.push(componentObject);
              componentItem.licenses = licenses;
              return componentItem
            }else{
              warnings.push({
                component: componentItem.component.getKey(),
                version: componentItem.version,
                status: 'license_not_found'
              })
            }
          }else{
            warnings.push({
              component: componentItem.component.getKey(),
              version: componentItem.version,
              status: 'version_not_found'
            })
          }
        });
        try {
          const data = await checkComponentForCompany(companyId, project._id, module._id, list);
          const company = await Companies.findOneAsync(module.companyId);
          if(company){
            const mappedData = _.map(data,function (oneResult){
              oneResult.changed.computedStatus = Utils.computedLicenseStatusDetails(module, project, company, oneResult.license,
                oneResult.changed);
              oneResult.not_changed.computedStatus = Utils.computedLicenseStatusDetails(module, project, company, oneResult.license,
                oneResult.not_changed);
              if(oneResult.changed.obligations){
                oneResult.changed.obligations = _.map(oneResult.changed.obligations.split('; '),function (obligation) {
                  let details = Utils.translateObligations(obligation);
                  return {
                    type: 'obligation',
                    message: (details && details.description) || obligation
                  }
                });
              }else{
                oneResult.changed.obligations = [];
              }
              if(oneResult.changed.violations){
                oneResult.changed.violations = _.map(oneResult.changed.violations.split('; '),function (violation) {
                  let details = Utils.translatePermitions(violation);
                  return {
                    type: (details && details.type) || 'violation',
                    message: (details && details.message) || violation
                  }
                });
              }else{
                oneResult.changed.violations = [];
              }
              if(oneResult.not_changed.obligations){
                oneResult.not_changed.obligations = _.map(oneResult.not_changed.obligations.split('; '),function (obligation) {
                  let details = Utils.translateObligations(obligation);
                  return {
                    type: 'obligation',
                    message: (details && details.description) || obligation
                  }
                });
              }else{
                oneResult.not_changed.obligations = [];
              }
              if(oneResult.not_changed.violations){
                oneResult.not_changed.violations = _.map(oneResult.not_changed.violations.split('; '),function (violation) {
                  let details = Utils.translatePermitions(violation);
                  return {
                    type: (details && details.type) || 'violation',
                    message: (details && details.message) || violation
                  }
                });
              }else{
                oneResult.not_changed.violations = [];
              }
              delete oneResult.changed.status;
              delete oneResult.not_changed.status;
              return oneResult
            });
            response.end(JSON.stringify({ok: warnings.length <= 0, warnings, data: mappedData}));
          }
        } catch(error) {
          response.statusCode = 400;
          response.end(JSON.stringify({error}));
        }
      }else{
        response.statusCode = 404;
        response.end(JSON.stringify({error: 'Components not found'}));
      }
    }else{
      response.statusCode = 404;
      response.end(JSON.stringify({error: 'Module "'+ moduleName +'" not found in project "'+projectName+'"'}));
    }
  }else{
    response.statusCode = 404;
    response.end(JSON.stringify({error: 'Project "'+ projectName +'" not found'}));
  }
}

//
//    OPTIONS
//
function handleOptions(request, params, response) {
  response.setHeader('Access-Control-Allow-Methods', 'PATCH, GET, OPTIONS');
  response.end('OPTIONS Response');
}

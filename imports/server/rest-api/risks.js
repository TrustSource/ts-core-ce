import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Meteor} from 'meteor/meteor';
import {Random} from 'meteor/random';
import _ from 'underscore';
import RestApi from './RestApi';
import {helpers} from './apiSchema';
import Utils from '/imports/server/ServerUtils';

const FETCH_LIMIT = 100;
const RESOURCE_NF = 'Resource not found: '
const SCOPE_LIMITED = 'API-key scope is limited'
const FIND_TASK = 'Tasks.FindOne'
const FIND_RISK = 'RiskProperties.FindOneById'

Router.route('/api/v2/core/risks', {
  name: 'apiRisksRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/risks/:id', {
  name: 'apiRiskRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/risks/:id/tasks', {
  name: 'apiRiskTasksRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/risks/:id/tasks/:taskId', {
  name: 'apiRiskTaskRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/risks/:id/countermeasures', {
  name: 'apiRiskCountermeasuresRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/risks/:id/countermeasures/:cmId', {
  name: 'apiRiskCountermeasureRoute',
  where: 'server',
  action: RestApi.wrapAsync(getRisks),
  trackPageView: false                // don't report page changes to google analytics
});

function isCountermeasurePath(request) {
  return request._parsedUrl.pathname.indexOf('/countermeasures') !== -1;
}

// Inline countermeasures supplied via the risk endpoints get an _id assigned
// so they are individually addressable via /risks/:id/countermeasures/:cmId
function ensureCountermeasureIds(riskProperties) {
  if (riskProperties && Array.isArray(riskProperties.countermeasures)) {
    riskProperties.countermeasures.forEach(function (cm) {
      if (cm && typeof cm === 'object' && !cm._id) {
        cm._id = Random.id();
      }
    });
  }
}

async function getRisks() {
  RestApi.requestLogger(this.request, this.params, 'risks');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'POST') {
    if (isCountermeasurePath(this.request)) {
      await handlePostCountermeasures(this.request, this.params, this.response);
    } else if (this.request._parsedUrl.pathname.endsWith('/tasks') || this.request._parsedUrl.pathname.endsWith('/tasks/') || this.params.taskId) {
      await handlePostTasks(this.request, this.params, this.response);
    }else{
      await handlePost(this.request, this.params, this.response);
    }
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

async function handlePost(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'portfolio_manager',
    'compliance_manager', 'company_security_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  // Strip MongoDB operators from body before merging
  const safeBody = {};
  _.each(body, function (value, key) { if (!key.startsWith('$')) safeBody[key] = value; });
  let risk = _.extend(safeBody, {
    companyId: keyMetaAndCompany.company._id
  });
  if (params.id) {
    const current = await Meteor.callAsync(FIND_RISK, {
      _id: params.id,
      companyId: keyMetaAndCompany.company._id
    });
    if(!current){
      response.statusCode = 404;
      response.end(JSON.stringify(RESOURCE_NF + params.id));
      return;
    }
    // Merge riskProperties one level deep - a shallow extend would replace the
    // whole object and silently drop countermeasures/threatModelContext on
    // partial updates that don't include them
    if (current.riskProperties && risk.riskProperties) {
      risk.riskProperties = _.extend({}, current.riskProperties, risk.riskProperties);
    }
    risk = _.extend(current, risk);
  }
  ensureCountermeasureIds(risk.riskProperties);
  const context = helpers.cleanAndValidateRisk(risk);
  if (context.isValid()) {
    if (!params.id) {
      const riskId = await Meteor.callAsync('RiskProperties.Create',risk, keyMetaAndCompany.user);
      response.statusCode = 201;
      const result = {
        riskId
      };
      response.end(JSON.stringify(result));
    }else{
      try {
        const count = await Meteor.callAsync('RiskProperties.Update',{$set: risk}, params.id, null, keyMetaAndCompany.user);
        if(count === 1 || count === 0){
          const current = await Meteor.callAsync(FIND_RISK, {
            _id: params.id,
            companyId: keyMetaAndCompany.company._id
          });
          response.statusCode = 200;
          response.end(JSON.stringify(current));
        }
      }catch (e) {
        response.statusCode = 400;
        const respStr = {error: e.toString()};
        console.log('Error updating risk: ', respStr);
        response.end(JSON.stringify(respStr));
      }
    }
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error creating/updating risk: ', respStr);
    response.end(respStr);
  }
}

async function handlePostTasks(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'portfolio_manager',
    'compliance_manager', 'company_security_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  // The risk in the path owns the task: it must exist in the caller's company, and
  // its id is the task's riskId whatever the body says.
  const risk = await Meteor.callAsync(FIND_RISK, {
    _id: params.id,
    companyId: keyMetaAndCompany.company._id
  });
  if (!risk) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }

  // Strip MongoDB operators from body before merging
  const safeTaskBody = {};
  _.each(body, function (value, key) { if (!key.startsWith('$')) safeTaskBody[key] = value; });
  let task = _.extend(safeTaskBody, {
    companyId: keyMetaAndCompany.company._id,
    riskId: params.id
  });
  if (params.taskId) {
    const current = await Meteor.callAsync(FIND_TASK, {
      _id: params.taskId,
      companyId: keyMetaAndCompany.company._id
    });
    if(!current){
      response.statusCode = 404;
      response.end(JSON.stringify(RESOURCE_NF + params.taskId));
      return;
    }
    task = _.extend(current, task);
  }
  const context = helpers.cleanAndValidateTask(task);
  if (context.isValid()) {
    if (!params.taskId) {
      const taskId = await Meteor.callAsync('Tasks.Create',task, keyMetaAndCompany.user);
      response.statusCode = 201;
      response.end(JSON.stringify({taskId, riskId: params.id}));
    }else{
      try {
        const count = await Meteor.callAsync('Tasks.Update', params.taskId, null, {$set: task}, keyMetaAndCompany.user);
        if(count === 1 || count === 0){
          const current = await Meteor.callAsync(FIND_TASK, {
            _id: params.taskId,
            companyId: keyMetaAndCompany.company._id
          });
          response.statusCode = 200;
          response.end(JSON.stringify(current));
        }
      }catch (e) {
        response.statusCode = 400;
        const respStr = {error: e.toString()};
        console.log('Error updating task: ', respStr);
        response.end(JSON.stringify(respStr));
      }
    }
  } else {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error creating/updating task: ', respStr);
    response.end(respStr);
  }
}

async function handlePostCountermeasures(request, params, response) {
  const body = request.body;
  const headers = request.headers || {};

  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || (body && body.apiKey));

  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return;
  }

  if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['developer', 'manager', 'portfolio_manager',
    'compliance_manager', 'company_security_manager'])){
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return;
  }

  const risk = await Meteor.callAsync(FIND_RISK, {
    _id: params.id,
    companyId: keyMetaAndCompany.company._id
  });
  if (!risk) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }

  // Strip MongoDB operators and server-managed fields from the body
  const safeBody = {};
  _.each(body, function (value, key) {
    if (!key.startsWith('$') && key !== '_id' && key !== 'apiKey') safeBody[key] = value;
  });

  const list = (risk.riskProperties && risk.riskProperties.countermeasures) || [];
  let item;
  let countermeasures;
  if (params.cmId) {
    const current = _.find(list, function (cm) { return cm._id === params.cmId; });
    if (!current) {
      response.statusCode = 404;
      response.end(JSON.stringify(RESOURCE_NF + params.cmId));
      return;
    }
    item = _.extend({}, current, safeBody);
    countermeasures = list.map(function (cm) { return cm._id === params.cmId ? item : cm; });
  } else {
    item = _.extend({_id: Random.id()}, safeBody);
    countermeasures = list.concat([item]);
  }

  const context = helpers.cleanAndValidateCountermeasure(item);
  if (!context.isValid()) {
    response.statusCode = 400;
    const respStr = RestApi.createErrorResponse(context);
    console.log('Error creating/updating countermeasure: ', respStr);
    response.end(respStr);
    return;
  }

  try {
    await Meteor.callAsync('RiskProperties.Update',
      {$set: {'riskProperties.countermeasures': countermeasures}},
      params.id, null, keyMetaAndCompany.user);
    if (params.cmId) {
      response.statusCode = 200;
      response.end(JSON.stringify(item));
    } else {
      response.statusCode = 201;
      response.end(JSON.stringify({countermeasureId: item._id}));
    }
  } catch (e) {
    response.statusCode = 400;
    const respStr = {error: e.toString()};
    console.log('Error saving countermeasure: ', respStr);
    response.end(JSON.stringify(respStr));
  }
}

// GET /risks/:id/countermeasures[/:cmId] - query already carries the tenant companyId
async function handleGetCountermeasures(params, response, query) {
  query._id = params.id;
  const risk = await Meteor.callAsync(FIND_RISK, query);
  if (!risk) {
    response.statusCode = 404;
    response.end(JSON.stringify(RESOURCE_NF + params.id));
    return;
  }
  const list = (risk.riskProperties && risk.riskProperties.countermeasures) || [];
  if (params.cmId) {
    const item = _.find(list, function (cm) { return cm._id === params.cmId; });
    if (item) {
      response.end(JSON.stringify(item));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify(RESOURCE_NF + params.cmId));
    }
  } else {
    response.end(JSON.stringify(list));
  }
}

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
    let query = {
      companyId: keyMetaAndCompany.company._id
    };
    response.setHeader('Cache-Control', 'no-cache, no-store');
    if (params.id) {
      if (isCountermeasurePath(request)) {
        await handleGetCountermeasures(params, response, query);
      } else if (request._parsedUrl.pathname.endsWith('/tasks') || request._parsedUrl.pathname.endsWith('/tasks/')) {
        let tasks;
        query.page = request.query.page
        query.riskId = params.id
        const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0)*FETCH_LIMIT)
        query.options = {limit: FETCH_LIMIT, skip, sort:{created: -1}, fields: {companyId: 0}}
        tasks = await Meteor.callAsync('Tasks.Find', query);
        response.end(JSON.stringify(tasks));
      } else {
        if(params.taskId){
          query._id = params.taskId;
          const task = await Meteor.callAsync(FIND_TASK, query);
          if (task) {
            response.end(JSON.stringify(task));
          } else {
            response.statusCode = 404;
            response.end(JSON.stringify(RESOURCE_NF + params.id));
          }
        }else{
          query._id = params.id;
          const risk = await Meteor.callAsync(FIND_RISK, query);
          if (risk) {
            response.end(JSON.stringify(risk));
          } else {
            response.statusCode = 404;
            response.end(JSON.stringify(RESOURCE_NF + params.id));
          }
        }
      }
    } else {
      let risks;
      query.moduleId = request.query.moduleId
      query.projectId = request.query.projectId
      if(!query.moduleId && !query.projectId){
        response.statusCode = 400;
        response.end(JSON.stringify({error: 'projectId or moduleId is required'}));
        return;
      }
      query.page = request.query.page
      const skip = Math.floor((request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0)*FETCH_LIMIT)
      query.options = {limit: FETCH_LIMIT, skip, sort:{created: -1}, fields: {companyId: 0}}
      risks = await Meteor.callAsync('RiskProperties.Find', query);
      response.end(JSON.stringify(risks));
    }
  }
}

async function handleDelete(request, params, response) {
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey( headers['x-api-key']);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
  } else {
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['manager','account_admin', 'portfolio_manager',
      'company_security_manager'])){
      response.statusCode = 403;
      response.end(JSON.stringify(SCOPE_LIMITED));
      return;
    }
    let query = {companyId: keyMetaAndCompany.company._id};
    response.setHeader('Cache-Control', 'no-cache, no-store');
    if (params.cmId) {
      query._id = params.id;
      const risk = await Meteor.callAsync(FIND_RISK, query);
      const list = (risk && risk.riskProperties && risk.riskProperties.countermeasures) || [];
      const item = _.find(list, function (cm) { return cm._id === params.cmId; });
      if (risk && item) {
        const countermeasures = _.reject(list, function (cm) { return cm._id === params.cmId; });
        await Meteor.callAsync('RiskProperties.Update',
          {$set: {'riskProperties.countermeasures': countermeasures}},
          params.id, null, keyMetaAndCompany.user);
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + (risk ? params.cmId : params.id)));
      }
    } else if (params.taskId) {
      query._id = params.taskId;
      let task = await Meteor.callAsync(FIND_TASK, query);
      if (task) {
        await Meteor.callAsync('Tasks.Remove', query._id, query, keyMetaAndCompany.user)
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify(RESOURCE_NF + params.id));
      }
    } else if (params.id) {
      query._id = params.id;
      const risk = await Meteor.callAsync(FIND_RISK, query);
      if (risk) {
        const taskQuery = {
          companyId: query.companyId,
          riskId: query._id
        }
        const hasTasks = await Meteor.callAsync(FIND_TASK, taskQuery)
        const isForced = params.query && params.query.force && (params.query.force === true || params.query.force === 'true')
        if(!isForced && hasTasks){
          response.statusCode = 400;
          response.end(JSON.stringify('Sorry, ensure to delete all associated tasks ' +
            'before removing the risk or use ?force=true option'));
          return;
        }
        if(hasTasks){
          await Meteor.callAsync('Tasks.Remove', null, taskQuery, keyMetaAndCompany.user)
        }
        await Meteor.callAsync('RiskProperties.Remove', query._id, query, keyMetaAndCompany.user)
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

function handleOptions(request, params, response) {
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

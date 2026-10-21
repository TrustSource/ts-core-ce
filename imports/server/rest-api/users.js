import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';
import Utils from '/imports/server/ServerUtils';

Router.route('/api/v2/core/users/nologin', {
  name: 'apiUsersNoLoginRoute',
  where: 'server',
  action: RestApi.wrapAsync(getUsersNoLogin),
  trackPageView: false
});

async function getUsersNoLogin() {
  RestApi.requestLogger(this.request, this.params, 'users/nologin');
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    const name = this.route.getName()
    if(name.indexOf('NoLogin') > -1) {
      await handleGet(this.request, this.params, this.response)
    }
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.request, this.params, this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
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
    if(!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, ['account_admin'])){
      response.statusCode = 403;
      response.end(JSON.stringify('API-key scope is limited'));
      return;
    }
    response.setHeader('Cache-Control', 'no-cache, no-store');
    let users = await Meteor.callAsync('LoginsHistory.NoLoginsByCompany', keyMetaAndCompany.company._id);
    response.end(JSON.stringify(users));
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

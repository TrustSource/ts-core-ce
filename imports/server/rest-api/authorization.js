import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';

Router.route('/api/v2/account/authorization', {
  name: 'apiAuthorization',
  where: 'server',
  action: RestApi.wrapAsync(getAuthorization),
  trackPageView: false                // don't report page changes to google analytics
});

async function getAuthorization() {
  RestApi.requestLogger(this.request, this.params, 'authorization');
  this.response.statusCode = 200;
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    let request = this.request;
    const headers = request.headers || {};
    const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
    if (keyMetaAndCompany.error) {
      this.response.statusCode = keyMetaAndCompany.statusCode;
      this.response.end(JSON.stringify(keyMetaAndCompany.error));
    } else {
      this.response.setHeader('Cache-Control', 'no-cache, no-store');
      this.response.end(JSON.stringify('Authorization is ok'));
    }
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

//
//    OPTIONS
//
function handleOptions(response) {
  // console.log('now in handleOptions');
  response.end();
}


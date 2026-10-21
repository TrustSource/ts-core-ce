import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';

Router.route('/api/v2/compliance/company/foss', {
  name: 'apiCompanyFossRoute',
  where: 'server',
  action: RestApi.wrapAsync(getFoss),
  trackPageView: false                // don't report page changes to google analytics
});

async function getFoss() {
  RestApi.requestLogger(this.request, this.params, 'company-foss');
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
      await handleGet(this.request, this.params, this.response);
    }
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

//
//    GET Requests
//
async function handleGet(request, params, response) {
  response.setHeader('Cache-Control', 'no-cache, no-store');
  const headers = request.headers || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key']);
  if (keyMetaAndCompany && keyMetaAndCompany.company) {
    try {
      const data = await Meteor.callAsync('getCompanyFoss', keyMetaAndCompany.company._id);
      if (data) {
        let object = {
          'company': data.company,
          'name': data.name,
          'email': data.email,
          'phone': data.phone,
          'zip': data.zip,
          'address': data.address,
          'country': data.country,
          'url': data.url
        };
        response.end(JSON.stringify(object));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify('Resource not found ['+response.statusCode+']'));
      }
    } catch (error) {
      response.end(JSON.stringify(error.message));
    }
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify('Resource not found ['+response.statusCode+']'));
  }
}

//
//    OPTIONS
//
function handleOptions(response) {
  //console.log('now in handleOptions');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.end();
}

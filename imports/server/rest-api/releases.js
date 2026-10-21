import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';

Router.route('/api/v2/compliance/releases/:id/sbom', {
  name: 'apiPublicReleaseSbomRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

Router.route('/api/v2/compliance/releases/:id/notice', {
  name: 'apiPublicReleaseNoticeRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

Router.route('/api/v2/compliance/releases/:id/csaf', {
  name: 'apiPublicReleaseVexRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

Router.route('/api/v2/compliance/releases/:id/csaf-changes', {
  name: 'apiPublicReleaseVexChangesRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

async function getResponse() {
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'GET') {
    // :id is the release key itself.
    RestApi.requestLogger(this.request, this.params, 'public-Releases', ['id']);
    if (this.params.id) {
      const name = this.route.getName()
      this.response.setHeader('Cache-Control', 'no-cache, no-store');
      if(name.indexOf('Sbom') > -1) {
        await handleGetSbom(this.request, this.params, this.response);
      }
      if(name.indexOf('Notice') > -1) {
        await handleGetNotice(this.request, this.params, this.response);
      }
      if(name.indexOf('Vex') > -1){
        if(this.route.getName() === 'apiPublicReleaseVexChangesRoute'){
          await handleGetVex(this.request, this.params, this.response, true);
        }else{
          await handleGetVex(this.request, this.params, this.response);
        }
      }
    }else{
      this.response.statusCode = 400;
      this.response.end(JSON.stringify('Release ID param is required'));
    }
  } else if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
  } else {
    this.response.statusCode = 405;
    this.response.end(JSON.stringify('Method Not Allowed'));
  }
}

function notFound(response, params){
  response.statusCode = 404;
  response.end(JSON.stringify('Resource not found: ' + params.id + ' ['+response.statusCode+']'));
}

// These routes are UNAUTHENTICATED, so an internal error message is published to
// whoever asks. The VEX generator's own errors name the module they failed on
// (imports/lib/converter/vex.js) - a raw internal `_id` on the exact surface the
// product_id encoding exists to keep it off - and any future error added
// anywhere under `publicVexKey.getFile` inherits the same echo. The caller gets a
// fixed string; the real message is logged where an operator can read it.
//
// Status handling is RestApi.errorStatus: the response defaults to 200, so a catch
// that only writes a body reports a failure as a success.
const FAILED_BODY = 'The requested document could not be produced';

function failed(response, params, error, route) {
  console.error(`[public-Releases] ${route} failed for ${params && params.id}:`,
    error && error.message);
  response.statusCode = RestApi.errorStatus(error);
  response.end(JSON.stringify(FAILED_BODY));
}

//
//    GET Requests
//
async function handleGetSbom(request, params, response) {
  try {
    const publicBoMKey = await Meteor.callAsync('publicBoMKey.one', params.id);
    if (publicBoMKey) {
      try {
        const fileData = await Meteor.callAsync('publicBoMKey.getFile', publicBoMKey);
        await Meteor.callAsync('publicBoMKey.saveRequest', params.id, request.connection.remoteAddress);
        response.end(JSON.stringify(fileData));
      } catch (error) {
        failed(response, params, error, 'sbom');
      }
    } else {
      notFound(response, params);
    }
  } catch (error) {
    failed(response, params, error, 'sbom');
  }
}
async function handleGetNotice(request, params, response) {
  try {
    const publicNoticeKey = await Meteor.callAsync('publicNoticeKey.one', params.id);
    if (publicNoticeKey) {
      try {
        const fileData = await Meteor.callAsync('publicNoticeKey.getFile', publicNoticeKey);
        await Meteor.callAsync('publicNoticeKey.saveRequest', params.id, request.connection.remoteAddress);
        response.end(JSON.stringify(fileData));
      } catch (error) {
        failed(response, params, error, 'notice');
      }
    } else {
      notFound(response, params);
    }
  } catch (error) {
    failed(response, params, error, 'notice');
  }
}
async function handleGetVex(request, params, response, changesOnly) {
  try {
    const publicReleaseKey = await Meteor.callAsync('publicReleaseKey.one', params.id);
    const type = changesOnly ? 'changes' : 'release';
    if (publicReleaseKey) {
      try {
        const fileData = await Meteor.callAsync('publicVexKey.getFile', publicReleaseKey, type);
        await Meteor.callAsync('publicReleaseKey.saveRequest', params.id, request.connection.remoteAddress);
        response.end(JSON.stringify(fileData));
      } catch (error) {
        failed(response, params, error, 'csaf');
      }
    } else {
      notFound(response, params);
    }
  } catch (error) {
    failed(response, params, error, 'csaf');
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

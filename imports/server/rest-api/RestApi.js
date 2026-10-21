/* global Buffer: false */
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {packageTypeFacetQuery} from '/imports/lib/component/criticalPackageFacets';
import Busboy from 'busboy';
import _ from 'underscore';
import Semver from 'semver';
import {moment} from 'meteor/momentjs:moment';
import Companies from '/imports/lib/collections/companies';
import SemverExt from '/imports/lib/component/SemverExt';
import Utils from '/imports/lib/utils';
import {drainRequestBody} from '/imports/server/rest-api/wrapAsyncHelpers';
import {hmacCandidates} from '/imports/lib/crypto';
import {accountStatusOf, ACCOUNT_STATUS} from '/imports/lib/accountStatus';
import {recordApiKeyUsage} from '/imports/server/collections/apiKeyUsage';
import {readMultipartBody} from './multipartBody';
import {uploadMaxBytes} from '/imports/server/security/uploadGuards';

const HOMEPAGES = 'urls.homepage'
const CONTENT_TYPE = 'Content-Type'

/**
 * Wraps an async route action for Iron Router server routes.
 * Iron Router does not await async actions - this wrapper catches Promise
 * rejections and ensures the response is always ended.
 */
function wrapAsync(fn) {
  return function () {
    const self = this;
    // Iron Router server routes put URL query params on request.query, not params.query
    if (self.request && self.request.query) {
      if (!self.params) self.params = {};
      self.params.query = Object.assign({}, self.params.query, self.request.query);
    }
    // Bodyless methods (GET/DELETE/OPTIONS/HEAD) never read request.body, but the
    // registered parsers skip multipart/form-data - an unread body left on a
    // keep-alive socket stalls the response and trips a load-balancer 500.
    // Drain it so the connection closes cleanly. POST/PUT/PATCH are left alone:
    // their handlers read request.body or pipe the stream through busboy.
    if (self.request) drainRequestBody(self.request);
    fn.call(self).catch(err => {
      console.error('REST API error:', err);
      if (!self.response.writableEnded) {
        self.response.statusCode = 500;
        self.response.end(JSON.stringify({error: 'Internal Server Error', message: err.message}));
      }
    });
  };
}

// The HTTP status a failed public GET should answer with. The public release routes
// default the response to 200 (`getResponse` sets it up front), so a catch that only
// writes a body reports a failure as a success. `publicBoMKey.one` / `publicNoticeKey.one` /
// `publicReleaseKey.one` throw Meteor.Error(404) for an unknown key rather than
// returning falsy, so the explicit not-found branch in those handlers never runs.
// Carry the error's own code when it is a usable HTTP status, else treat it as a
// server fault. Lives here so releases.js does not carry a private copy.
function errorStatus(error) {
  return (error && error.error >= 400 && error.error < 600) ? error.error : 500;
}

const RestApi = {
  wrapAsync: wrapAsync,
  errorStatus: errorStatus,
  requestLogger: requestLogger,
  maskLogParams: maskLogParams,
  sendMailToUser: sendMailToUser,
  getKeyMetaAndCompanyByAccountAndApiKey: getKeyMetaAndCompanyByAccountAndApiKey,
  mapComponent: mapComponent,
  getFilterQuery: getFilterQuery,
  evaluateUserAgent: evaluateUserAgent,
  evaluateProject: evaluateProject,
  createErrorResponse: createErrorResponse,
  getFilterCritical: getFilterCritical,
  parseFile: parseFile,
  parseMultipartFile: parseMultipartFile
};

export default RestApi;

function sendUploadError(req, res, status, message) {
  res.setHeader(CONTENT_TYPE, 'application/json');
  if (status === 413) {
    // Nothing past the limit is kept (readMultipartBody discards it), but the
    // rest of the upload is drained rather than cut off: a proxy in front of the
    // app turns a connection closed mid-request into a 502/503 instead of this
    // 413. The connection is closed once the request ends.
    res.setHeader('Connection', 'close');
  }
  drainRequestBody(req);
  res.writeHead(status);
  res.end(JSON.stringify({error: message}));
}

// Multipart uploads for routes that read the API key from the x-api-key header
// only. The key is looked up later, in the route; a request that does not even
// carry one is refused here, before its body is read. The body is read with the
// TS_UPLOAD_MAX_MB limit either way.
function parseFile (req, res, next) {
  const headersContentType = req && req.headers && req.headers['content-type']
  if(headersContentType && headersContentType.indexOf('multipart/form-data') === 0){
    if (!req.headers['x-api-key']) {
      res.setHeader(CONTENT_TYPE, 'application/json');
      res.setHeader('Connection', 'close');
      res.writeHead(401);
      res.end(JSON.stringify('API-key missing'), () => req.destroy());
      return;
    }
    readMultipartBody(req, {Busboy, maxBytes: uploadMaxBytes(process.env)}).then((body) => {
      if(!body.documentContent){
        sendUploadError(req, res, 400, 'SyntaxError: Invalid file input');
        return;
      }
      const isJson = body.mimeType === 'application/json' || body.mimeType === 'application/octet-stream'
      if(isJson && !Utils.isJsonString(body.documentContent)) {
        sendUploadError(req, res, 400, 'SyntaxError: Invalid JSON input');
        return;
      }
      let blob = Buffer.from(body.documentContent, 'utf8');
      req.body = isJson ? JSON.parse(blob) : blob
      next();
    }).catch((error) => {
      sendUploadError(req, res, error.status || 400, error.message || String(error));
    });
  }else{
    next();
  }
}

// Like parseFile, but preserves the file metadata and any other multipart form
// fields instead of collapsing req.body to just the file content. Sets
// req.body = { documentContent: <Buffer>, filename, mimeType, encoding, ...fields }.
// Use for uploads that carry a binary file together with metadata (e.g. a
// product photo/document with a documentType field). Non-multipart requests
// (JSON, OPTIONS) pass straight through untouched.
function parseMultipartFile (req, res, next) {
  const headersContentType = req && req.headers && req.headers['content-type']
  if (headersContentType && headersContentType.indexOf('multipart/form-data') === 0) {
    // These routes also accept the API key as a form field, so it cannot be
    // required before the body is read; the TS_UPLOAD_MAX_MB limit bounds it.
    readMultipartBody(req, {Busboy, maxBytes: uploadMaxBytes(process.env)}).then((body) => {
      req.body = body;
      next();
    }).catch((error) => {
      sendUploadError(req, res, error.status || 400, error.message || String(error));
    });
  } else {
    next();
  }
}

function getFilterCritical(ecosystem) {
  let query = {
    $and: [{
      $or: [{'versions.licenses': {$size: 0}}, {
        versions: {
          $elemMatch: {
            version: {$exists: true},
            licenses: {$exists: false}
          }
        }
      }, {
        'versions.licenses': {
          $elemMatch: {
            name: {$exists: true},
            key: {$exists: false}
          }
        }
      }, {
        'urls.repository': {$exists: false}
      }, {
        'urls.repository': {$eq: ''}
      }]
    }]
  }
  if (ecosystem && typeof ecosystem === 'string') {
    // A package type can be stored under more than one key prefix - apk also as
    // alpine:, Go as go: and golang:, Dart as pub:. The Critical Components tab
    // strip knows those aliases, so this reads them from the same table.
    // Anything not in the table stays a single literal prefix.
    const facetQuery = packageTypeFacetQuery(ecosystem)
    if (facetQuery) {
      query['$and'].push(facetQuery)
    } else {
      // Escape regex metacharacters: ecosystem is a literal prefix, never a pattern
      const safeEcosystem = ecosystem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query['$and'].push({key: {$regex: new RegExp('^' + safeEcosystem + ':')}})
    }
  }
  return query
}

// Route and query parameters that carry a credential are masked in the request
// log: on the public feeds the release or CSAF feed key is a path parameter, and
// an API key may be sent as ?apiKey=. Container logs and log shippers keep them.
const SECRET_QUERY_PARAMS = ['apiKey', 'apikey', 'key'];

function maskLogParams(params, secretParams) {
  const masked = Object.assign({}, params);
  (secretParams || []).forEach(function (name) {
    if (masked[name] !== undefined) {
      masked[name] = '<redacted>';
    }
  });
  if (params && params.query && typeof params.query === 'object') {
    masked.query = Object.assign({}, params.query);
    SECRET_QUERY_PARAMS.forEach(function (name) {
      if (masked.query[name] !== undefined) {
        masked.query[name] = '<redacted>';
      }
    });
  }
  return masked;
}

/**
 * @param {Object} request
 * @param {Object} params      the route parameters
 * @param {String} [endpoint]  name for the log line
 * @param {String[]} [secretParams] route parameters that are credentials
 */
function requestLogger(request, params, endpoint, secretParams) {
  let name = endpoint ? endpoint : request.url.split('/api/v2/').pop();
  console.log('=> ' + request.method + ' - ' + name + ' -', maskLogParams(params, secretParams));
}

async function sendMailToUser(user, module, scanId) {
  if (user && user.profile && user.profile.email) {
    let recipient, notifications;
    try {
      await Meteor.callAsync('logEvent', user, 'New scan ' + scanId + ' created for ' + module, 'scanCreated');
      recipient = user.profile.email;
      notifications = user.profile.notifications;
      if (notifications && _.contains('EVENTS_ALL')) {
        await Meteor.callAsync('sendEmail', recipient, 'New scan received',
          'New scan received for module: ' + module);
      }
    } catch (error) {
      console.log('RestApi.sendMailToUser() error', error);
    }
  } else {
    // Only the id: the user document carries login tokens and the password hash.
    console.log('RestApi.sendMailToUser(): user.profile.email not configured for user', user && user._id);
  }
}


function mapComponent(proComp, component) {
  const result = {
    name: component.getName(),
    versions: []
  };

  if (component.getUrl('homepage')) {
    result.homepageUrl = component.getUrl('homepage');
  }

  proComp.versions.forEach(function (v) {
    const version = component.findVersion(v.version);
    if (version) {
      const resVersion = {version: version.getVersion(), licenses: []};
      if(version.getPackageUrl()){
        resVersion.purl = version.getPackageUrl()
      }

      version.getLicenses(component.getDeclaredLicenses()).forEach(function (lic) {
        const licKey = lic.getKey();
        const resLicense = {
          name: lic.getName(),
          spdxKey: licKey
        };
        const licUrl = lic.getUrl();
        if (licUrl) {
          resLicense.url = licUrl;
        }
        if (licKey === 'COMMERCIAL') {
          result.status = 'commercial';
        } else if (licKey && !result.status) {
          result.status = 'os';
        }

        resVersion.licenses.push(resLicense);
      });
      result.versions.push(resVersion);
    }
  });

  if (!result.status) {
    result.status = 'unknown';
  }

  return result;
}

function getFilterQuery(filter) {
  const compareDateLocal = new Date();
  const FILTER_Q = {
    'mavencentral-checksum': {
      $and: [{
        'versions.checksums': {$exists: true}
      }, {
        $or: [
          {key: {$regex: /^maven:.*/}},
          {key: {$regex: /^mvn:.*/}},
          {key: {$regex: /^im:.*/}}
        ]
      }, {
        $or: [{'versions.checksums.qos': {$exists: false}},
          {'versions.checksums.qos': {$lt: 2}}]
      }]
    },
    'mavencentral-releases': {
      $and: [{
        'versions.checksums': {$exists: true}
      }, {
        $or: [
          {key: {$regex: /^maven:.*/}},
          {key: {$regex: /^mvn:.*/}},
          {key: {$regex: /^im:.*/}}
        ]
      }, {
        $or: [
          {'crawlerInfo.mavencentral-releases': {$exists: false}},
          {'crawlerInfo.mavencentral-releases.lastVisit': {'$lt': compareDateLocal}}
        ]
      }]
    },
    'nuget-releases': {
      $and: [{
        $or: [
          {key: {$regex: /^nuget:.*/}},
          {key: {$regex: /^netcore:.*/}},
          {key: {$regex: /^netframework:.*/}},
          {key: {$regex: /^im:.*/}}
        ]
      }, {
        $or: [
          {'crawlerInfo.nuget-releases': {$exists: false}},
          {'crawlerInfo.nuget-releases.lastVisit': {'$lt': compareDateLocal}}
        ]
      }]
    },
    'github': {
      $and: [{
        $or: [
          {'urls.repository': {$regex: /github\.com/i}},
          {
            'urls.repository': {$exists: false},
            [HOMEPAGES]: {$regex: /github\.com/i}
          }
        ]
      }, {
        $or: [
          {'crawlerInfo.github': {$exists: false}},
          {'crawlerInfo.github.lastVisit': {$lt: compareDateLocal}}
        ]
      }]
    },
    'npm-releases': {
      $and: [{
        $or: [
          {key: {$regex: /^npm:.*/}},
          {key: {$regex: /^im:.*/}}
        ]
      }, {
        $or: [
          {'crawlerInfo.npm-releases': {$exists: false}},
          {'crawlerInfo.npm-releases.lastVisit': {'$lt': compareDateLocal}}
        ]
      }
      ]
    },
    'pypi': {
      $and: [{
        $or: [
          {key: {$regex: /^pypi:.*/}},
          {key: {$regex: /^pip:.*/}},
          {key: {$regex: /^im:.*/}}
        ]
      }, {
        $or: [
          {'crawlerInfo.pypi': {$exists: false}},
          {'crawlerInfo.pypi.lastVisit': {'$lt': compareDateLocal}}
        ]
      }
      ]
    }
  };
  return FILTER_Q[filter];
}

function evaluateUserAgent(userAgent) {
  const KNOWN_USER_AGENTS = {
    'ecs-mvn-plugin': '0.2.3',
    'ecs-grunt-plugin': '0.1.8',
    'ecs-gradle-plugin': '0.2.1',
    'ecs-node-client': '0.3.2',
    'ecs-composer': '1.0.1',
    'ecs-bundler': '1.0.1',
    'ecs-nuget': '1.0.0',
    'ecs-pip-plugin': '1.0.3',
    'ts-dotnet': '1.0.0',
    'ts-mvn-plugin': '0.2.3',
    'ts-grunt-plugin': '0.1.8',
    'ts-gradle-plugin': '0.2.1',
    'ts-node-client': '3.4.5',
    'ts-composer': '1.0.1',
    'ts-bundler': '1.0.1',
    'ts-nuget': '1.0.0',
    'ts-pip-plugin': '1.0.3',
    'TS-NetCore-Scanner': '1.0.0',
    'import-cyclonedx':'1.0.0',
    'import-spdx':'1.0.0',
    'import-sarif':'1.0.0',
    'ts-pypi': '1.0.0',
    'api-test': '1.0.0'
  };

  userAgent = (userAgent || '').trim();

  if (userAgent.length === 0) {
    return {error: 400, message: 'mandatory User-Agent header missing'};
  }

  const info = userAgent.split('/', 2);  // agent/agent-version
  const minVersion = KNOWN_USER_AGENTS[info[0]];
  if (!minVersion) {
    return {message: `unknown user-agent: '${userAgent}'`};
  }

  if (info.length < 1 || !SemverExt.isValid(info[1])) {
    return {message: `invalid version format of user-agent: '${info[1] || ''}'`};
  }

  if (Semver.lt(info[1], minVersion)) {
    return {message: `attention: you are using an outdated version of '${info[0]}'! Please update as soon as possible.`};
  }
  return {};
}

function evaluateProject(project, projectParam) {
  if (!project && projectParam) {
    return {message: `attention: you are using an unknown project '${projectParam}'! Please change param or create new project. Current module will be available in Unassigned Modules`};// eslint-disable-line max-len
  }
  return {};
}


function createErrorResponse(context, userAgentStatus, contentNotices) {
  const result = {
    error: 'Bad Request',
    object: context.__errorObject,
    description: context.__errorDescription || 'Invalid properties',
    messages: []
  };
  if (userAgentStatus && userAgentStatus.message) {
    result.info = userAgentStatus.message;
  }
  if (contentNotices) {
    result.contentNotices = contentNotices;
  }
  const keys = (context.invalidKeys || context.validationErrors).call(context);
  if (keys instanceof Array) {
    keys.forEach(function (key) {
      const msg = context.keyErrorMessage(key.name);
      result.messages.push({
        message: msg,
        details: key
      });
    });
  }
  return JSON.stringify(result);
}

// The scope a personal access key has now: its stored scope narrowed to the roles
// its owner still holds in the company. Empty when the owner is gone or suspended.
async function personalKeyScope(keyMeta, companyId) {
  const owner = await Meteor.users.findOneAsync(keyMeta.userId, {fields: {_id: 1, accountStatus: 1}});
  if (!owner || accountStatusOf(owner) !== ACCOUNT_STATUS.ACTIVE) {
    return [];
  }
  const roles = await Roles.getRolesForUserAsync(owner._id, {scope: companyId});
  return (Array.isArray(keyMeta.scope) ? keyMeta.scope : []).filter((role) => roles.indexOf(role) > -1);
}

async function getKeyMetaAndCompanyByAccountAndApiKey(apiKey) {
  const result = {};
  // apiKey may arrive from a request body field (not just the x-api-key header),
  // so it MUST be a plain string - otherwise an object like {$gt:''} / {$ne:null}
  // injected as `apiKey` turns the $elemMatch into an operator match and
  // authenticates the caller as an arbitrary company (auth bypass).
  if (apiKey && typeof apiKey === 'string') {
    // Look up by the presented key's HMAC hash only. `apiKeys[].key` holds the
    // v2: ciphertext, so comparing the presented value with it would make the
    // ciphertext itself a credential. A legacy plaintext entry (no keyHash) does
    // not authenticate until it is upgraded: by the TS_REENCRYPT_SECRETS bulk
    // migration, or when an account admin opens the API keys page
    // (upgradeApiKeysIfNeeded).
    // During a key rotation a key may still be stored under its previous hash.
    const keyHashes = hmacCandidates(apiKey);
    result.company = await Companies.findOneAsync(
      {'apiKeys': { $elemMatch: { keyHash: {$in: keyHashes}, published: true } }},
      {fields: {statistics: 0}});
    if (result.company) {
      result.keyMeta = _.find(result.company.apiKeys, function (key) {
        return keyHashes.indexOf(key.keyHash) > -1 && key.published === true;
      });
    }
    // A personal access key acts with its owner's rights as they are now, not as
    // they were when it was created: an owner who left the company, lost every
    // role or was suspended takes the key's access with them. Only the request is
    // narrowed; the stored scope is kept for when the roles come back.
    let effectiveScope;
    if (result.company && result.keyMeta && result.keyMeta.userId) {
      effectiveScope = await personalKeyScope(result.keyMeta, result.company._id);
      if (!effectiveScope.length) {
        result.keyMeta = undefined;
      }
    }
    if(result.company && result.keyMeta){
      // Not awaited: counting a request must not slow it down or fail it.
      recordApiKeyUsage(result.company._id, result.keyMeta.id);
      const today = new Date()
      if(!result.keyMeta.lastUsedDate){
        result.keyMeta.lastUsedDate = today
        await Meteor.callAsync('apiKey.logActivity', result.company._id, result.keyMeta);
      }else{
        const dateToCheck = moment(result.keyMeta.lastUsedDate);
        if(!dateToCheck.isSame(today, 'day')){
          result.keyMeta.lastUsedDate = today
          await Meteor.callAsync('apiKey.logActivity', result.company._id, result.keyMeta);
        }
      }
      result.user = {
        _id: 'api',
        profile: {
          companyId: result.company._id,
          name: result.keyMeta.name || 'Unnamed ApiKey',
          email: 'apiKey'
        }
      }
      if (effectiveScope) {
        result.keyMeta = Object.assign({}, result.keyMeta, {scope: effectiveScope});
      }
    }
    if (!(result.company && result.keyMeta)) {
      delete result.company;
      delete result.keyMeta;
      result.statusCode = 403;
      result.error = 'Invalid API-key';
    }
  } else {
    result.statusCode = 401;
    result.error = 'API-key missing';
  }
  return result;
}

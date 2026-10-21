import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import RestApi from './RestApi';
import CSAF from '/imports/lib/collections/csaf';
const {buildFeedQuery, buildFeedDocumentQuery, isTlpAccessible} = require('/imports/lib/csaf/feedAccess');

Router.route('/api/v2/compliance/csaf/:key/documents', {
  name: 'apiCsafFeedListRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

Router.route('/api/v2/compliance/csaf/:key/documents/:id', {
  name: 'apiCsafFeedDocumentRoute',
  where: 'server',
  action: RestApi.wrapAsync(getResponse),
  trackPageView: false
});

function setHeaders(response) {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
  response.setHeader('Cache-Control', 'no-cache, no-store');
}

function handleOptions(response) {
  response.statusCode = 200;
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');
  response.end();
}

function notFound(response) {
  response.statusCode = 404;
  response.end(JSON.stringify('Resource not found'));
}

async function getResponse() {
  setHeaders(this.response);

  if (this.request.method === 'OPTIONS') {
    return handleOptions(this.response);
  }
  if (this.request.method !== 'GET') {
    this.response.statusCode = 405;
    return this.response.end(JSON.stringify('Method Not Allowed'));
  }

  // :key is the CSAF feed key itself.
  RestApi.requestLogger(this.request, this.params, 'csaf-feed', ['key']);

  const key = this.params.key;
  if (typeof key !== 'string' || !key) {
    return notFound(this.response);
  }

  let access;
  try {
    access = await Meteor.callAsync('publicCsafKey.findByKey', key);
  } catch {
    return notFound(this.response);
  }
  if (!access) {
    return notFound(this.response);
  }

  try {
    if (this.params.id) {
      await handleGetDocument(access, this.params, this.response);
    } else {
      await handleGetList(access, this.response);
    }
    await Meteor.callAsync('publicCsafKey.saveRequest', key, this.request.connection.remoteAddress);
  } catch (error) {
    this.response.statusCode = 400;
    this.response.end(JSON.stringify(error && error.message ? error.message : 'Bad Request'));
  }
}

async function handleGetList(access, response) {
  const query = buildFeedQuery(access.companyId, access.csafKey);
  const docs = await CSAF.find(query, {
    fields: {tlp: 1, category: 1, name: 1, published: 1, publishedFileName: 1, data: 1},
    sort: {published: -1}
  }).fetchAsync();

  const items = docs.map(function (doc) {
    let trackingId = doc.publishedFileName;
    let title;
    try {
      const parsed = JSON.parse(doc.data);
      trackingId = (parsed.document && parsed.document.tracking && parsed.document.tracking.id) || trackingId;
      title = parsed.document && parsed.document.title;
    } catch { /* leave fallbacks */ }
    return {
      id: doc._id,
      trackingId: trackingId,
      title: title || doc.name,
      category: doc.category,
      tlp: doc.tlp,
      published: doc.published
    };
  });

  response.end(JSON.stringify(items));
}

async function handleGetDocument(access, params, response) {
  if (typeof params.id !== 'string') {
    return notFound(response);
  }
  // Only published documents; drafts are never served.
  const doc = await CSAF.findOneAsync(buildFeedDocumentQuery(access.companyId, params.id));
  if (!doc || !isTlpAccessible(doc.tlp, access.csafKey)) {
    return notFound(response);
  }
  let parsed;
  try {
    parsed = JSON.parse(doc.data);
  } catch {
    return notFound(response);
  }
  response.end(JSON.stringify(parsed));
}

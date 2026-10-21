/* global require:false, process:false, __meteor_runtime_config__:false */
const PACKAGE_VERSION = require('../package.json').version

const isServer = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

if (isServer && process.env.NODE_ENV === 'development' && !process.env.METEOR_UPLOAD_FOLDER) {
  try {
    const dotenv = require('dotenv');
    const path = require('path');
    dotenv.config({path: path.resolve(process.cwd(), '../../../../..', '.env')});
  } catch {
    // dotenv not available or .env missing - fall through to default below
  }
}

function resolveUploadFolder() {
  if (isServer && process.env.METEOR_UPLOAD_FOLDER) {
    return process.env.METEOR_UPLOAD_FOLDER;
  }
  if (isServer && process.env.NODE_ENV === 'development') {
    const path = require('path');
    return path.resolve(process.cwd(), '../../../../..', '.app.storage/files');
  }
  return '/app.storage/files';
}

// Self sign-up on/off (REGISTRATION_ENABLED, see imports/server/config.js). On
// the client it comes from the public setting imports/startup/server/registration.js
// publishes; missing means off, the server default.
function resolveRegistrationEnabled() {
  if (isServer) {
    return process.env.REGISTRATION_ENABLED === 'true';
  }
  return typeof __meteor_runtime_config__ !== 'undefined'
    && !!__meteor_runtime_config__.PUBLIC_SETTINGS
    && __meteor_runtime_config__.PUBLIC_SETTINGS.registrationEnabled === true;
}

// The address of this installation (ROOT_URL), always with a trailing slash. Links
// in generated documents, reports and mails are built from it. On the client the
// server hands ROOT_URL over in the Meteor runtime config.
function resolveAppUrl() {
  let url = isServer ? process.env.ROOT_URL
    : (typeof __meteor_runtime_config__ !== 'undefined' && __meteor_runtime_config__.ROOT_URL);
  if (!url && typeof window !== 'undefined' && window.location) {
    url = window.location.origin;
  }
  url = url || 'http://localhost:3000';
  return url.endsWith('/') ? url : url + '/';
}

export const Config = {
  name: 'TrustSource CE',
  fullName: 'TrustSource CE',
  title: 'The modern Art of Open Source Compliance',
  copyright: 'Copyright &copy; '+ new Date().getFullYear(),
  EACG: '<a href="http://www.eacg.de" target="_blank">Enterprise Architecture Consulting Group - EACG&nbsp;GmbH</a>',
  version: PACKAGE_VERSION,
  // Where /landing sends the user (logo links, after sign-up): the app itself, not the
  // TrustSource website. '/' opens the dashboard, or the sign-in card when signed out.
  landingUrl: '/',
  get appUrl() {
    return resolveAppUrl();
  },
  // AGPL-3.0 section 13: users of the running app must be offered its source.
  sourceUrl: 'https://github.com/TrustSource/ts-core-ce',
  // Where users report problems: the public repository.
  supportUrl: 'https://github.com/TrustSource/ts-core-ce/issues',
  // Where users read the documentation: the Community Edition online help.
  helpUrl: 'https://help.trustsource.io/ce/',
  baseUrl: 'http://localhost:3000',
  mongoUrl: 'mongodb://localhost:3001/meteor/',
  METEOR_UPLOAD_FOLDER: resolveUploadFolder(),
  registrationEnabled: resolveRegistrationEnabled()
};

Config.footer1 = '<strong>' + Config.name + ' ' + Config.version + '</strong>: ' + Config.title;
Config.footer2 = Config.copyright + ' ' + Config.EACG;

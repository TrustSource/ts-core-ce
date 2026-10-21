/* global Buffer:false, Promise: false */
import FormData from 'form-data';
import {Roles} from 'meteor/alanning:roles';
import {Meteor} from 'meteor/meteor';
import {Config} from '/imports/server/config';
import CSAF from '/imports/lib/collections/csaf';
import Companies from '/imports/lib/collections/companies';
import bcrypt from 'bcrypt';
import Utils from '/imports/lib/utils';
const {extractTlp, providerTlpDirectory} = require('/imports/lib/csaf/feedAccess');
const {providerConfigErrors, resolveProviderConfig} = require('/imports/server/csaf/providerConfig');

const CSAF_PREFIX_MAP = {
  csaf_security_advisory:       ['csafPrefixSecurityAdvisory',       'tssa'],
  csaf_vex:                     ['csafPrefixVex',                    'tsvx'],
  csaf_informational_advisory:  ['csafPrefixInformationalAdvisory',  'tsia'],
  csaf_security_incident:       ['csafPrefixSecurityIncident',       'tssi']
};

function resolvePrefix(company, category) {
  const [field, fallback] = CSAF_PREFIX_MAP[category] || CSAF_PREFIX_MAP.csaf_security_advisory;
  return (company && company[field]) || fallback;
}

async function getApiParams(formData, password, urlBase) {
  const contentLength = await new Promise((resolve, reject) => {
    formData.getLength((err, length) => {
      if (err) reject(err);
      else resolve(length);
    });
  });
  const options = {
    headers: {
      'X-CSAF-PROVIDER-AUTH': password,
      ...formData.getHeaders(),
      'Content-Length': contentLength
    }
  };

  if(Config.DEBUG_MODE_ENABLED){
    // X-CSAF-PROVIDER-AUTH carries the credential the provider authenticates on,
    // so it is redacted rather than printed with the rest of the headers.
    const safeHeaders = {...options.headers, 'X-CSAF-PROVIDER-AUTH': '[redacted]'};
    console.log(`=> ts-csaf details ${JSON.stringify({url: urlBase, options: {headers: safeHeaders}})}`);
  }

  return {url: urlBase, options};
}

function padNumber(num) {
  return num.toString().padStart(5, '0');
}

Meteor.methods({
  tsCsafUpload: async function (csafId, externalUser) {
    this.unblock();
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, ['company_security_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (typeof csafId !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    const csaf = await CSAF.findOneAsync(csafId);
    // Tenant isolation: only publish/mutate a CSAF document owned by the
    // caller's company (otherwise a security_manager could publish another
    // tenant's CSAF and flip its status by id).
    if (!csaf || csaf.companyId !== user.profile.companyId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    // Behind the authorization gate on purpose: only someone who may publish this
    // document learns whether the provider is configured. The publish button stays
    // enabled when it is not, so this message is the operator's only guidance -
    // hence every unset variable by name rather than a generic failure.
    const configErrors = providerConfigErrors(Config);
    if (configErrors.length) {
      throw new Meteor.Error('csaf-provider-not-configured',
        `CSAF provider is not configured: ${configErrors.join('; ')}. Set these environment variables on the server and restart it.`);
    }
    const provider = resolveProviderConfig(Config);
    if(Config.DEBUG_MODE_ENABLED){
      console.info(`=> tsCsafUpload started: csafId=${csafId}, providerId=${csaf && csaf.providerId}, userId=${user._id}`);
    }
    let fileData;
    try {
      fileData = csaf && JSON.parse(csaf.data);
    } catch {
      throw new Meteor.Error('invalid-json', 'Failed to parse CSAF document data');
    }
    if (!fileData || typeof fileData !== 'object') {
      throw new Meteor.Error('invalid-json', 'Invalid JSON data provided');
    }
    const passphrase = provider.passphrase;
    const password = await bcrypt.hash(provider.password, 10);

    const category = fileData.document && fileData.document.category;
    const year = new Date().getFullYear();
    let newFileName = fileData.document.tracking.id
    if(!newFileName || !csaf.published){
      const company = await Companies.findOneAsync(csaf.companyId);
      const prefix = resolvePrefix(company, category);
      const prefixEscaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const number = padNumber(await CSAF.find({
        providerId: csaf.providerId,
        publishedFileName: { $regex: `^${prefixEscaped}-${year}-`, $options: 'i' }
      }).countAsync() + 1);
      newFileName = `${prefix}-${year}-${number}`
      fileData.document.tracking.id = newFileName
    }

    // The provider files each document under its TLP directory, so the upload and the
    // canonical self reference both follow the document's label.
    const tlpDirectory = providerTlpDirectory(fileData);
    const selfUrl = `${provider.baseUrl}.well-known/csaf/${tlpDirectory}/${year}/${newFileName}.json`;
    if (!Array.isArray(fileData.document.references)) {
      fileData.document.references = [];
    }
    const selfRef = fileData.document.references.find(r => r && r.category === 'self');
    if (selfRef) {
      selfRef.url = selfUrl;
    } else {
      fileData.document.references.push({ category: 'self', summary: 'Canonical URL', url: selfUrl });
    }

    if(Config.DEBUG_MODE_ENABLED){
      console.info(`=> tsCsafUpload: fileName=${newFileName}, validating CSAF document`);
    }
    await Meteor.callAsync('CSAF.Validate', {file: JSON.stringify(fileData)})

    const jsonString = JSON.stringify(fileData, null, 2);
    const jsonBuffer = Buffer.from(jsonString, 'utf-8');

    const formData = new FormData();
    formData.append('csaf', jsonBuffer, { filename: `${newFileName}.json`, contentType: 'application/json' });
    formData.append('tlp', tlpDirectory);
    formData.append('passphrase', passphrase);

    let request;
    try {
      let {url, options} = await getApiParams(formData, password, provider.baseUrl);
      if(Config.DEBUG_MODE_ENABLED){
        console.info(`=> tsCsafUpload: posting to ${url}cgi-bin/provider/api/upload`);
      }
      const response = await fetch(`${url}cgi-bin/provider/api/upload`, {
        method: 'POST',
        headers: options.headers,
        body: formData.getBuffer()
      });
      const responseData = await response.json().catch(() => null);
      if (!response.ok) {
        throw {message: response.statusText, response: {data: responseData || {errors: [response.statusText]}}};
      }
      request = {data: responseData};
      if(Config.DEBUG_MODE_ENABLED){
        console.info('=> tsCsafUpload response:', { status: request.status, data: request.data });
      }
      if(request.data){
        await CSAF.updateAsync(csafId, {$set:{
          status: 'PUBLISHED',
          published: new Date(),
          publishedBy: Utils.userId(externalUser),
          publishedByName: Utils.username(externalUser),
          publishedFileName: request.data.name,
          tlp: extractTlp(fileData),
          data: JSON.stringify(fileData)
        }})
        await Meteor.callAsync('logEvent', Utils.getUser(externalUser), csafId, 'csafPublished');
        return request.data
      }
    } catch (error) {
      const statusCode = error.response && error.response.status ? error.response.status : 500;
      let errorText = error && error.message ? error.message : 'Unknown error';
      let errorDetails = '';
      if(error.response && error.response.data){
        if(error.response.data.errors){
          errorText = error.response.data.errors.join(', ')
        } else if(typeof error.response.data === 'string'){
          errorDetails = error.response.data;
        } else {
          errorDetails = JSON.stringify(error.response.data);
        }
      }
      console.error(`=> tsCsafUpload error for csafId=${csafId}: status=${statusCode}, message=${errorText}${errorDetails ? ', details=' + errorDetails : ''}`);
      if(error.response && error.response.headers){
        console.error('=> tsCsafUpload response headers:', JSON.stringify(error.response.headers));
      }
      await CSAF.updateAsync(csafId, {$set:{
        status: 'FAILED',
        failed: new Date(),
        failedReason: errorText
      }})
      await Meteor.callAsync('logEvent', Utils.getUser(externalUser), csafId, 'csafUpdated');
      throw new Meteor.Error(String(statusCode), 'CSAF upload failed');
    }
    return request;
  }
});

// One-time backfill: derive `tlp` for existing documents that were stored
// before the field existed (missing or null tlp), reading it from their data.
Meteor.startup(async function () {
  const missing = await CSAF.find(
    {$or: [{tlp: {$exists: false}}, {tlp: null}], data: {$exists: true}},
    {fields: {data: 1}}
  ).fetchAsync();
  let filled = 0;
  for (const doc of missing) {
    const tlp = extractTlp(doc.data);
    if (tlp) {
      await CSAF.updateAsync(doc._id, {$set: {tlp: tlp}});
      filled += 1;
    }
  }
  if (filled) {
    console.info(`=> CSAF tlp backfill: set tlp on ${filled} of ${missing.length} document(s)`);
  }
});

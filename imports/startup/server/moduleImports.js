import {Meteor} from 'meteor/meteor';
import ImportConverter from '/imports/server/rest-api/ImportConverter';
import ModuleImports, {readImportFileContent} from '/imports/lib/collections/moduleImports';
import Projects from '/imports/lib/collections/projects';
import Companies from '/imports/lib/collections/companies';
import {helpers} from '/imports/server/rest-api/apiSchema';
import RestApi from '/imports/server/rest-api/RestApi';
import RestApiScans from '/imports/server/rest-api/scans';
import detectSpdxFormat from '/imports/lib/spdx/detectFormat';

// The UI import is not an HTTP call, so it reports itself as v2 - the current contract.
const API_VERSION = 2;

function getUserEmail(user) {
  return ((user.profile && user.profile.email)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
}

// Same shape the REST response uses for a dependency that failed schema validation, flattened
// into something storable on the import document.
function buildImportWarning(contextDependency) {
  if (!contextDependency || !contextDependency.__errorObject) return null;
  const messages = [];
  const keys = contextDependency.validationErrors();
  if (keys instanceof Array) {
    keys.forEach(function (key) {
      messages.push({message: contextDependency.keyErrorMessage(key.name), details: key});
    });
  }
  return {object: contextDependency.__errorObject, messages: messages};
}

// Content notices are counted by the API's internal enum (apiSchema.js validateDependencyLicenses
// tags every unresolvable license as `unknownLicense`). That enum belongs in a JSON response, not
// in a line a user reads, so give each kind the wording the scan detail view already uses
// ("Scan validation found Unknown licenses:", scan/scan-detail.html) in singular and plural.
const CONTENT_NOTICE_LABELS = {
  unknownLicense: {one: 'unknown license', other: 'unknown licenses'}
};

function describeContentNotice(type, count) {
  const label = CONTENT_NOTICE_LABELS[type];
  // An unmapped kind still has to say something, so fall back to the raw type.
  if (!label) { return count + ' ' + type; }
  return count + ' ' + (count === 1 ? label.one : label.other);
}

// `__errorObject` is the machine tag the JSON error body carries ("Dependency:lodash").
const DEPENDENCY_TAG = 'Dependency:';

function describeErrorObject(object) {
  if (typeof object !== 'string' || !object) { return null; }
  if (object.indexOf(DEPENDENCY_TAG) !== 0) { return object; }
  const name = object.slice(DEPENDENCY_TAG.length).trim();
  return name ? 'Dependency "' + name + '"' : 'Dependency';
}

// SimpleSchema opens every message with the offending field's humanized label, so a component
// key that fails its pattern reads "Key failed regular expression validation" - a bare schema
// label that means nothing to the person looking at the Imports tab. Name the field instead and
// keep the rest of the sentence as SimpleSchema phrased it.
function describeValidationMessage(entry) {
  const message = entry && typeof entry.message === 'string' ? entry.message : '';
  const field = entry && entry.details && typeof entry.details.name === 'string' ? entry.details.name : '';
  if (!message) { return field ? 'field "' + field + '" is invalid' : null; }
  if (!field) { return message; }
  const label = message.split(' ')[0];
  if (label.toLowerCase() !== field.toLowerCase()) { return message; }
  return 'field "' + field + '"' + message.slice(label.length);
}

// One short line for the Imports tab, which shows `meta.reason` next to the status.
function summarizeImportNotices(warning, contentNotices) {
  const parts = [];
  if (warning && warning.messages && warning.messages.length) {
    const subject = describeErrorObject(warning.object);
    const detail = describeValidationMessage(warning.messages[0]);
    if (subject && detail) {
      parts.push(subject + ': ' + detail);
    } else if (subject || detail) {
      parts.push(subject ? subject + ' is invalid' : detail);
    }
  }
  if (contentNotices && contentNotices.types) {
    // Sorted, so the same set of notices always produces the same line.
    Object.keys(contentNotices.types).sort().forEach(function (type) {
      parts.push(describeContentNotice(type, contentNotices.types[type]));
    });
  }
  return parts.length ? parts.join('; ') : null;
}

// The module name travels with the upload as client-supplied metadata, so it is coerced
// to a plain trimmed string of sane length before it can reach a query or a module document.
const MAX_MODULE_NAME = 255;
function sanitizeModuleName(value) {
  if (typeof value !== 'string') { return undefined; }
  const name = value.trim().slice(0, MAX_MODULE_NAME);
  return name || undefined;
}

// The import file must have been uploaded for the project it is imported into. Owning the
// target project is not enough: without this, any import file id (another company's upload
// included) could be read into the caller's project.
// Only JSON payloads are parsed; RDF/XML (SPDX) is kept as a string and parsed downstream.
function parseImportData(data) {
  if (typeof data === 'string' && /^\s*[{[]/.test(data)) {
    try { return JSON.parse(data); } catch (e) { console.debug('Import data looked like JSON but failed to parse', e.message); }
  }
  return data;
}

async function findImportFileForProject(fileObj, projectId) {
  const fileId = fileObj && typeof fileObj._id === 'string' ? fileObj._id : null;
  const file = fileId && await ModuleImports.collection.findOneAsync(fileId);
  if (!file || !file.meta || typeof projectId !== 'string' || file.meta.projectId !== projectId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  return file;
}

Meteor.methods({
  'ModuleImports.Create': async function ({projectId, file, type, moduleName}) {
    // Tenant isolation: only import into a project owned by the caller's company,
    // and attribute the import to the authenticated user (not a client-supplied id).
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId || typeof projectId !== 'string'
      || !await Projects.findOneAsync({_id: projectId, companyId}, {fields: {_id: 1}})) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const userId = user._id;
    const upload = ModuleImports.insert({
      file: file,
      chunkSize: 'dynamic',
      meta: {projectId, userId, type, moduleName: sanitizeModuleName(moduleName), status: 'CREATED'}
    }, false);

    upload.on('end', async function (error, fileObj) {
      if(!error){
        await Meteor.callAsync('ModuleImports.ImportModule', {projectId, userId, fileObj})
      }
    });

    upload.start();
    return upload
  },

  'ModuleImports.ImportModule': async function ({projectId, userId, fileObj}) {
    // Direct client calls must own the project; the internal call from the upload
    // callback above runs with no DDP user (trusted) and is allowed through.
    const caller = await Meteor.userAsync();
    if (caller) {
      const callerCompanyId = caller.profile && caller.profile.companyId;
      if (!callerCompanyId || typeof projectId !== 'string'
        || !await Projects.findOneAsync({_id: projectId, companyId: callerCompanyId}, {fields: {_id: 1}})) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      // A client call imports as itself, never as the user it names.
      userId = caller._id;
    }
    const file = await findImportFileForProject(fileObj, projectId);
    await ModuleImports.collection.updateAsync(file._id, {$set:{'meta.created': new Date(), 'meta.status': 'STARTED'}})
    // Read the uploaded file directly on the server. Do NOT fetch it over HTTP via
    // ModuleImports.link(): that goes through the `protected` /cdn/storage route,
    // which requires a logged-in DDP session and 403s on a server-to-self request.
    const data = parseImportData(await readImportFileContent(file));
    if (fileObj.meta.type === 'cyclonedx' && typeof data === 'string' && data.trim().startsWith('<')) {
      // Only CycloneDX JSON is supported; an XML BOM would otherwise fail schema
      // validation with a message that does not say what is wrong.
      const respStr = '400 CycloneDX import supports JSON only (XML is not supported)';
      await ModuleImports.collection.updateAsync(fileObj._id, {$set:{'meta.status': 'ERROR', 'meta.reason': respStr}})
      return;
    }
    if(data){
      const type = fileObj.meta.type;
      // Prefer the authoritative server-side file doc for the extension hint.
      const ext = (fileObj.ext || file.ext || file.extension || '').toLowerCase();
      // Derive the format from the content itself (not just the extension hint):
      // an SPDX RDF/XML export must be parsed as RDF, otherwise it is wrongly
      // validated against the SPDX JSON schema and rejected.
      let format = (ext === 'rdf' || ext === 'xml') ? 'rdf' : 'json';
      if (type === 'spdx') {
        format = detectSpdxFormat(data, ext);
      }
      const params = {format};
      const context = helpers.cleanAndValidateImport(type, data, params);
      if (context && context.isValid && context.isValid()) {
        const project = await Projects.findOneAsync(projectId)
        const user = await Meteor.users.findOneAsync(userId);
        const convertParams = params
        // The module is named by what the user typed in the import form, not by the
        // uploaded file: naming it after the file made a `sbom.json` upload
        // create a module called `sbom.json`, which no other ingest path could ever match.
        // The file name remains the fallback for imports made before the field existed.
        const importedModuleName = sanitizeModuleName(fileObj.meta && fileObj.meta.moduleName)
          || sanitizeModuleName(file.meta && file.meta.moduleName) || file.name;
        convertParams.query = {project: project.getName(), module: importedModuleName}
        let scanBody =  ImportConverter.toScan(type, data, convertParams)
        // An empty list, not a missing key, is what an unmappable file produces:
        // the CycloneDX and SPDX readers always set `dependencies`, so testing the
        // key alone never fired. And without returning, ingestScan ran anyway and
        // the success path below overwrote the status back to FINISHED - a file
        // whose components could not be mapped was reported as a good import that
        // silently created an empty project and module.
        if(!scanBody.dependencies || !scanBody.dependencies.length){
          const respStr = '400 import file has no valid meta or components';
          await ModuleImports.collection.updateAsync(fileObj._id,
            {$set: {'meta.status': 'ERROR', 'meta.reason': respStr}})
          return;
        }
        scanBody.user = getUserEmail(user);
        const company = await Companies.findOneAsync(project.companyId);
        if (!company) {
          // ingestScan dereferences caller.company._id straight away, so without this the
          // import would throw and stay at STARTED forever with nothing recorded against it.
          const respStr = '404 company of the target project is not found';
          console.log('ModuleImports.ImportModule: company', project.companyId,
            'not found for project', projectId);
          await ModuleImports.collection.updateAsync(fileObj._id,
            {$set: {'meta.status': 'ERROR', 'meta.reason': respStr}});
          return;
        }
        // Same ingestion the REST endpoint runs (rest-api/scans.js): schema + dependency
        // validation, module resolve/create, content notices, crypto/AI properties, the insert
        // and the deferred analysis. Sharing it keeps the two import routes from drifting -
        // they now produce identical scan documents - and gives the UI the warnings and
        // notices that previously only an API caller ever saw.
        //
        // projectId travels as its own argument, NOT on scanBody: ingestScan validates the body
        // against ApiScanSchema, which declares no `projectId` and whose clean({filter: true})
        // would drop it. Passing it explicitly is what pins the scan to the project the user
        // actually picked instead of re-resolving it by name.
        const result = await RestApiScans.ingestScan({
          body: scanBody,
          caller: {company: company, user: user},
          apiVersion: API_VERSION,
          userAgentStatus: {},
          projectId: projectId
        });
        if (!result.ok) {
          const respStr = result.context
            ? '400 import file has invalid scan schema'
            : result.statusCode + ' ' + ((result.error && result.error.description) || 'import failed');
          console.log('ModuleImports.ImportModule ingest failed:',
            result.context ? JSON.stringify(RestApi.createErrorResponse(result.context)) : respStr);
          await ModuleImports.collection.updateAsync(fileObj._id,
            {$set: {'meta.status': 'ERROR', 'meta.reason': respStr}});
          return;
        }
        // No `scanCreated` log here: ingestScan defers RestApi.sendMailToUser(), which writes
        // exactly that entry (RestApi.js sendMailToUser) for both import routes. Logging it
        // again produced two identical audit records for every UI import.
        // Warnings and notices are stored on the import so the Imports tab can show them -
        // an invalid component key or an unknown license used to be silently dropped here.
        const importUpdate = {'meta.scanId': result.scanId, 'meta.status': 'FINISHED'};
        const warning = buildImportWarning(result.contextDependency);
        if (warning) { importUpdate['meta.warning'] = warning; }
        if (result.contentNotices) { importUpdate['meta.contentNotices'] = result.contentNotices; }
        const summary = summarizeImportNotices(warning, result.contentNotices);
        if (summary) { importUpdate['meta.reason'] = summary; }
        await ModuleImports.collection.updateAsync(fileObj._id, {$set: importUpdate})
      } else {
        const respStr = '400 import file has invalid schema';
        const preview = typeof data === 'string' ? data.slice(0, 120) : JSON.stringify(data).slice(0, 120);
        console.log('ModuleImports.ImportModule schema is invalid: '+ JSON.stringify(RestApi.createErrorResponse(context)) +
          ` [type=${type} format=${format} ext=${ext} dataType=${typeof data} preview=${preview}]`)
        await ModuleImports.collection.updateAsync(fileObj._id, {$set:{'meta.status': 'ERROR', 'meta.reason': respStr}})
      }
    }else{
      const respStr = '404 requested import file is not found';
      await ModuleImports.collection.updateAsync(fileObj._id, {$set:{'meta.status': 'ERROR', 'meta.reason': respStr}})
    }
  },

  'ModuleImports.Find': async function ({projectId}) {
    // Only return imports for a project the caller's company owns.
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if(companyId && typeof projectId === 'string'
      && await Projects.findOneAsync({_id: projectId, companyId}, {fields: {_id: 1}})){
      return await ModuleImports.find({'meta.projectId': projectId}).fetchAsync();
    }
    return []
  }
});

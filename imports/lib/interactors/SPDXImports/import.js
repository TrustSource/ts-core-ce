import {Meteor} from 'meteor/meteor';
import fs from 'fs';
import SPDXFiles from '/imports/lib/collections/SPDXFiles';
import SPDXImports from '/imports/lib/collections/SPDXImports';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import {SPDXParse} from '/imports/lib/spdx'
import Scans from '/imports/lib/collections/scans';
import processScan from '/imports/server/scan/processScan';
import Utils from '/imports/server/ServerUtils';

const fileReady = function (file, callback) {
  // For ostrio:files, files are available immediately after write
  // Small delay before reading the stored file
  let count = 0;
  let intervalHandle = Meteor.setInterval(function () {
    const fileRef = SPDXFiles.collection.findOne(file._id);
    if (fileRef || count > 50) {
      callback && Meteor.setTimeout(callback, 300);
      Meteor.clearInterval(intervalHandle);
    }
    count = count + 1;
  }, 1000);
};

const fileRead = function (file, callback) {
  const readPath = file.path || (file.versions && file.versions.original && file.versions.original.path);
  if (readPath && fs.existsSync(readPath)) {
    let content = '';
    fs.createReadStream(readPath)
      .on('error', Meteor.bindEnvironment(function (error) {
        callback(error, null);
      }))
      .on('data', Meteor.bindEnvironment(function (chunk) {
        content += chunk;
      }))
      .on('end', Meteor.bindEnvironment(function () {
        callback(null, content);
      }));
  } else {
    callback(new Error('SPDX file is not available on local storage'), null);
  }
};

const Component = function ({Name, SPDXID, LicenseId, DownloadURL, Homepage, Version, Description, Packages}) {
  const key = SPDXID || Name;
  return {
    name: Name,
    key: key.match(/:/) ? key : `:${key}`,
    versions: [Version].filter(version => version),
    description: Description,
    private: true,
    licenses: [{name: LicenseId}].filter(({name}) => name != null && name != ''),
    homepageUrl: Homepage,
    repoUrl: DownloadURL || Homepage,
    dependencies: Packages.map(Package => Component(Package))
  }
};

const createScan = async function (SPDXImportObj, spdxObject) {
  const user = SPDXImportObj.user();
  const module = await Modules.findOneAsync({projectId: SPDXImportObj.projectId, name: spdxObject.Name});
  const moduleId = module ? module._id : spdxObject.Package.SPDXID || (spdxObject.Package.Name || '').replace(/[^a-zA-Z.-]+/g, '-');
  const data = {
    user: user.profile.email,
    project: SPDXImportObj.project().name,
    projectId: SPDXImportObj.project()._id,
    module: spdxObject.Name,
    moduleId: moduleId,
    moduleIdentifier: module ? module.moduleIdentifier : moduleId,
    dependencies: [Component(spdxObject.Package)],
    companyId: await Utils.getCompanyIdForUserAsync(user._id),
    submitted: new Date()
  };
  const scanId = await Scans.insertAsync(data);
  await Meteor.callAsync('logEvent', user, 'New scan '+scanId+' created for '+spdxObject.Name, 'scanCreated');
  await SPDXImports.updateAsync(SPDXImportObj._id, {$set: {scanId}});
  Meteor.defer(function () {
    Promise.resolve(processScan(scanId, user)).catch(function (error) {
      console.error('=> SPDXImport: processScan failed for scan', scanId, '-', error.reason || error.message || error);
    });
  });
};

const SPDXImport = async function (SPDXImportID) {
  if (typeof SPDXImportID !== 'string') {
    throw new Meteor.Error(400, 'Invalid id');
  }
  // Tenant isolation: only a member of the company owning the import's target
  // project may (re)process it. createScan writes a scan + triggers processScan
  // into that project/company, so a raw foreign SPDXImportID must not be accepted.
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const SPDXImportObj = await SPDXImports.findOneAsync(SPDXImportID);
  if (!SPDXImportObj) {
    throw new Meteor.Error(404, 'Import not found');
  }
  const project = await Projects.findOneAsync(SPDXImportObj.projectId, {fields: {companyId: 1}});
  if (!project || project.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const original = SPDXImportObj.original();
  // The Community Edition imports SPDX RDF only, so the upload IS the RDF document -
  // there is no conversion step to run before reading it.
  const rdfFileId = original._id;
  await SPDXImports.updateAsync(SPDXImportID, {$set: {status: 'in progress', rdfFileId: rdfFileId}});
  let rdfFile = SPDXFiles.collection.findOne(rdfFileId);
  fileReady(rdfFile || {_id: rdfFileId}, async function () {
    rdfFile = SPDXFiles.collection.findOne(rdfFileId);
    fileRead(rdfFile, async function (error, content) {
      if (error) {
        await SPDXImports.updateAsync(SPDXImportID, {$set: {status: error}});
        throw error;
      }
      try {
        const scanData = SPDXParse(content);
        await createScan(SPDXImportObj, scanData);
        await SPDXImports.updateAsync(SPDXImportID, {$set: {status: 'finished'}});
      } catch (e) {
        await SPDXImports.updateAsync(SPDXImportID, {$set: {status: e.message}});
      }
    });
  });
};

export default SPDXImport;

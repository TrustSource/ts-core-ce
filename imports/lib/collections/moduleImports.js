import {Meteor} from 'meteor/meteor';
import {FilesCollection} from 'meteor/ostrio:files';
import {Config} from '/imports/config';
import Projects from '/imports/lib/collections/projects';
import {attachmentResponseHeaders} from '/imports/lib/files/downloadHeaders';

let path, fs, uploadPath;
if (Meteor.isServer) {
  const r = require;
  path = r('path');
  fs = r('fs');
  uploadPath = path.join((Config.METEOR_UPLOAD_FOLDER)+'/moduleImports');
}

// A document's file path is only trusted inside this collection's upload directory. The
// documents carry the path as data, so a path that points anywhere else (a rewritten
// document, or one from before the client write rules were closed) is never read or served.
function isInsideUploadDir(filePath) {
  if (typeof filePath !== 'string' || !filePath) { return false; }
  return path.resolve(filePath).startsWith(path.resolve(uploadPath) + path.sep);
}

function versionPathsInsideUploadDir(fileRef) {
  const versions = fileRef.versions && typeof fileRef.versions === 'object' ? fileRef.versions : {};
  return Object.keys(versions).every(function (name) {
    const vRef = versions[name];
    return !vRef || !vRef.path || isInsideUploadDir(vRef.path);
  });
}

/**
 * Read an uploaded import file's content directly on the server.
 *
 * The import pipeline must NOT fetch the file over HTTP through the
 * `/cdn/storage` download route: that route runs the `protected` callback
 * below, which requires a logged-in DDP session. A server-to-self HTTP request
 * has no session, so it gets 403. Reading the bytes directly avoids that and
 * keeps download authorization intact for real client requests.
 *
 * Returns the file content as a UTF-8 string, or null if it cannot be located or its
 * path is outside the upload directory.
 */
export async function readImportFileContent(fileRef, version = 'original') {
  const vRef = fileRef && fileRef.versions && fileRef.versions[version];
  if (!vRef || !isInsideUploadDir(vRef.path)) { return null; }
  return await fs.promises.readFile(vRef.path, 'utf8');
}

async function isOwnProjectUpload(context, meta) {
  const projectId = meta && meta.projectId;
  if (typeof projectId !== 'string' || !projectId || meta.userId !== context.userId) { return false; }
  const user = await context.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) { return false; }
  const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
  return !!project && project.companyId === companyId;
}

const ModuleImports = new FilesCollection({
  debug: false, // Change to `true` for debugging
  storagePath: uploadPath,
  collectionName: 'ModuleImports',
  allowClientCode: false,
  // Always a download, never rendered: the stored Content-Type is whatever the
  // uploader declared.
  responseHeaders: attachmentResponseHeaders,
  // Authorize downloads: without `protected`, the /cdn/storage route serves any
  // uploaded import file to anyone who knows its id (no auth). Only a logged-in
  // member of the company owning the import's project may fetch it - mirrors the
  // `moduleImports` publication's authorization predicate.
  async protected(fileRef) {
    if (!this.userId || !fileRef || !versionPathsInsideUploadDir(fileRef)) { return 403; }
    const user = await this.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    const projectId = fileRef.meta && fileRef.meta.projectId;
    if (!companyId || !projectId) { return 403; }
    const project = await Projects.findOneAsync(projectId, {fields: {companyId: 1}});
    return project && project.companyId === companyId ? true : 403;
  },
  async onBeforeUpload(file) {
    // Uploads need a logged-in user (`this.userId` is the uploading session's
    // user). The HTTP upload route is refused before this runs
    // (imports/startup/server/files-upload-guard.js).
    if (!this.userId) {
      return 'Please log in to upload files';
    }
    if (!(file.size <= 10485760 && /^(json|rdf|cdx|xml)$/i.test(file.extension))) {
      return 'Please upload a json, rdf, cdx or xml import file up to 10MB';
    }
    // `meta` comes from the uploading client and decides whose Imports tab lists the file
    // and who may download it (`protected` above), so on the server the project must
    // belong to the uploader's company and the upload is recorded as the uploader's own.
    if (Meteor.isServer && !await isOwnProjectUpload(this, file.meta)) {
      return 'Access Denied';
    }
    return true;
  }
});

export default ModuleImports;

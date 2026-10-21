import {Meteor} from 'meteor/meteor';
import {FilesCollection} from 'meteor/ostrio:files';
import {Config} from '/imports/config';
import SPDXExports from '/imports/lib/collections/SPDXExports';
import SPDXImports from '/imports/lib/collections/SPDXImports';
import Modules from '/imports/lib/collections/modules';
import Projects from '/imports/lib/collections/projects';
import {attachmentResponseHeaders} from '/imports/lib/files/downloadHeaders';

let path, uploadPath;
if (Meteor.isServer) {
  const r = require;
  path = r('path');
  uploadPath = path.join((Config.METEOR_UPLOAD_FOLDER)+'/SPDXFiles');
}

const SPDXFiles = new FilesCollection({
  debug: false,
  storagePath: uploadPath,
  collectionName: 'SPDXFiles',
  // Always a download, never rendered: the stored Content-Type is whatever the
  // uploader declared.
  responseHeaders: attachmentResponseHeaders,
  allowClientCode: true,
  // Authorize downloads: without `protected`, the /cdn/storage route serves any
  // SPDX file to anyone who knows its id (no auth). SPDX files carry no companyId
  // of their own - ownership is via the SPDX export (its module) or import (its
  // project) that references the file. Only a logged-in member of that company
  // may fetch it. (The public /spdx/:uuid route serves exports separately.)
  async protected(fileRef) {
    if (!this.userId || !fileRef) { return 403; }
    const user = await this.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) { return 403; }
    const fid = fileRef._id;
    const exp = await SPDXExports.findOneAsync(
      {$or: [{rdfFileId: fid}, {txtFileId: fid}, {xlsFileId: fid}]},
      {fields: {moduleId: 1}, transform: null});
    if (exp && await Modules.findOneAsync({_id: exp.moduleId, companyId}, {fields: {_id: 1}})) {
      return true;
    }
    const imp = await SPDXImports.findOneAsync({rdfFileId: fid}, {fields: {projectId: 1}, transform: null});
    if (imp && await Projects.findOneAsync({_id: imp.projectId, companyId}, {fields: {_id: 1}})) {
      return true;
    }
    return 403;
  },
  // Deny client-initiated removes - there is no client remove flow, and the
  // DDP remove method carries no ownership check, so a client could otherwise
  // delete another tenant's files. Server-side .remove() bypasses this hook.
  onBeforeRemove() {
    return false;
  },
  onBeforeUpload(file) {
    // Uploads need a logged-in user (`this.userId` is the uploading session's
    // user). The HTTP upload route is refused before this runs
    // (imports/startup/server/files-upload-guard.js).
    if (!this.userId) {
      return 'Please log in to upload files';
    }
    if (file.size <= 10 * 1024 * 1024 && /rdf|xls|txt/i.test(file.extension)) {
      return true;
    }
    return 'Please upload rdf, xls or txt file up to 10MB';
  }
});

export default SPDXFiles;

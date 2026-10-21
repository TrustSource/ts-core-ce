import {Meteor} from 'meteor/meteor';
import {FilesCollection} from 'meteor/ostrio:files';
import {Config} from '/imports/config';
import Policy from '/imports/lib/collections/policy';
import {attachmentResponseHeaders} from '/imports/lib/files/downloadHeaders';

let path, uploadPath;
if (Meteor.isServer) {
  const r = require;
  path = r('path');
  uploadPath = path.join((Config.METEOR_UPLOAD_FOLDER)+'/policyFiles');
}

const policyFiles = new FilesCollection({
  debug: false,
  storagePath: uploadPath,
  collectionName: 'policyFiles',
  // Always a download, never rendered: the stored Content-Type is whatever the
  // uploader declared.
  responseHeaders: attachmentResponseHeaders,
  allowClientCode: true,
  // Authorize downloads: without `protected`, the /cdn/storage route serves any
  // policy file to anyone who knows its id (no auth). Only a logged-in member of
  // the company whose Policy references this file may fetch it - mirrors the
  // `policyFiles` publication's authorization predicate.
  async protected(fileRef) {
    if (!this.userId || !fileRef) { return 403; }
    const user = await this.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) { return 403; }
    const owns = await Policy.findOneAsync({companyId, file: fileRef._id}, {fields: {_id: 1}});
    return owns ? true : 403;
  },
  // Deny client-initiated removes - clients only upload policy files, never
  // remove them, and the DDP remove method has no ownership check (cross-tenant
  // deletion). Server-side .remove() bypasses this hook.
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
    if (file.size <= 20 * 1024 * 1024 && /pdf|pptx/i.test(file.extension)) {
      return true;
    }
    return 'Policy file type should be one of *.pdf, *.pptx (max: 20mb)';
  }
});

export default policyFiles;

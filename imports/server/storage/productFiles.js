/* global Buffer:false */
import {Meteor} from 'meteor/meteor';
import uuid from 'uuid';
import JSZip from 'jszip';
import {
  PRODUCT_FILES_FOLDER, MAX_ARCHIVE_FILES, productFileExtension, productFileUrl, productFileRef
} from '/imports/server/storage/storagePaths';
import {putFile, readBuffer, removeFile} from '/imports/server/storage/fileStorage';

// Product documents and photos on local storage. Stored URLs are client-writable
// (Products.allow update), so every read or remove accepts a URL only as the name of
// one of the caller's own product files; nothing a client sends is ever fetched.

export async function storeProductFile({companyId, extension, data}) {
  const ext = productFileExtension(extension);
  const name = ext && `${uuid.v4()}.${ext}`;
  const url = name && productFileUrl(companyId, name);
  if (!url) {
    throw new Meteor.Error(400, 'Unsupported file type');
  }
  await putFile({companyId, folder: PRODUCT_FILES_FOLDER, name, data: Buffer.from(data)});
  return url;
}

export async function removeProductFile({companyId, url}) {
  const ref = productFileRef(url, companyId);
  if (!ref) {
    throw new Meteor.Error(400, 'URL does not name one of your product files');
  }
  await removeFile(ref);
}

export async function removeProductFileIfOwned({companyId, url}) {
  const ref = productFileRef(url, companyId);
  if (!ref) {
    return false;
  }
  await removeFile(ref);
  return true;
}

export async function buildProductFilesArchive({companyId, fileUrls}) {
  if (!Array.isArray(fileUrls) || fileUrls.length === 0 || fileUrls.length > MAX_ARCHIVE_FILES) {
    throw new Meteor.Error(400, `fileUrls must be a non-empty array of at most ${MAX_ARCHIVE_FILES} files`);
  }
  const refs = fileUrls.map((url) => productFileRef(url, companyId));
  if (refs.some((ref) => !ref)) {
    throw new Meteor.Error(400, 'fileUrls may only name your company\'s product files');
  }
  const zip = new JSZip();
  for (const ref of refs) {
    const buffer = await readBuffer(ref);
    if (!buffer) {
      throw new Meteor.Error(400, 'Failed to download file');
    }
    zip.file(ref.name, buffer);
  }
  const base64 = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: {level: 9}
  });
  return {base64, fileName: `archive-${Date.now()}.zip`};
}

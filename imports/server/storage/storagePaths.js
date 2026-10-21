// Where the Community Edition keeps its files, and which references to them are valid.
//
// Files live under one storage root (METEOR_UPLOAD_FOLDER, a Docker volume in
// production) as <companyId>/<folder>/<name>. Stored references reach this code from
// client-writable documents (Products.allow update, NoticeFiles.allow update), so a
// reference is only accepted when the company id, the folder and the name all pass a
// strict allow-list and the resolved path stays inside the root.
//
// CommonJS with no meteor/* imports so Jest can require it directly.

const path = require('path');

const NOTICE_FILES_FOLDER = 'notice-files';
const PRODUCT_FILES_FOLDER = 'product-files';

// A product has five document slots plus its photos; far below this.
const MAX_ARCHIVE_FILES = 50;

const COMPANY_ID = /^[A-Za-z0-9]{1,64}$/;
const EXTENSION = /^[a-z0-9]{1,10}$/;
const FOLDER_NAMES = {
  [NOTICE_FILES_FOLDER]: /^\d{1,20}\.json$/,
  [PRODUCT_FILES_FOLDER]: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/
};

const PRODUCT_FILES_ROUTE = '/files/products/';
const DOCUMENT_SLOTS = ['userManual', 'secureSetup', 'productDescription', 'sbom', 'cedoc'];

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function isValidCompanyId(companyId) {
  return typeof companyId === 'string' && COMPANY_ID.test(companyId);
}

function isValidName(folder, name) {
  return Object.prototype.hasOwnProperty.call(FOLDER_NAMES, folder) &&
    typeof name === 'string' && FOLDER_NAMES[folder].test(name);
}

function resolveStoragePath(root, companyId, folder, name) {
  if (typeof root !== 'string' || !root || !isValidCompanyId(companyId) || !isValidName(folder, name)) {
    return null;
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, companyId, folder, name);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

function productFileExtension(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const extension = value.trim().replace(/^\./, '').toLowerCase();
  return EXTENSION.test(extension) ? extension : null;
}

function productFileUrl(companyId, name) {
  if (!isValidCompanyId(companyId) || !isValidName(PRODUCT_FILES_FOLDER, name)) {
    return null;
  }
  return `${PRODUCT_FILES_ROUTE}${companyId}/${name}`;
}

function parseProductFileUrl(url) {
  if (typeof url !== 'string' || !url || /[?#]/.test(url)) {
    return null;
  }
  let pathname;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(PRODUCT_FILES_ROUTE)) {
    return null;
  }
  const parts = pathname.slice(PRODUCT_FILES_ROUTE.length).split('/');
  if (parts.length !== 2 || !isValidCompanyId(parts[0]) || !isValidName(PRODUCT_FILES_FOLDER, parts[1])) {
    return null;
  }
  return {companyId: parts[0], name: parts[1]};
}

function productFileRef(url, companyId) {
  const parsed = parseProductFileUrl(url);
  if (!parsed || !isValidCompanyId(companyId) || parsed.companyId !== companyId) {
    return null;
  }
  return {companyId, folder: PRODUCT_FILES_FOLDER, name: parsed.name};
}

function productFileContentType(name) {
  const extension = typeof name === 'string' ? name.split('.').pop() : '';
  return Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : 'application/octet-stream';
}

function absoluteFile(file, toAbsolute) {
  if (file && typeof file.url === 'string' && file.url.startsWith('/')) {
    return Object.assign({}, file, {url: toAbsolute(file.url)});
  }
  return file;
}

// Product files are stored with app-relative URLs; REST callers get absolute ones.
function withAbsoluteProductFileUrls(product, toAbsolute) {
  if (!product || !product.documents) {
    return product;
  }
  const documents = Object.assign({}, product.documents);
  DOCUMENT_SLOTS.forEach(function (slot) {
    if (documents[slot]) {
      documents[slot] = absoluteFile(documents[slot], toAbsolute);
    }
  });
  if (Array.isArray(documents.photos)) {
    documents.photos = documents.photos.map(function (photo) {
      return absoluteFile(photo, toAbsolute);
    });
  }
  return Object.assign({}, product, {documents});
}

module.exports = {
  NOTICE_FILES_FOLDER,
  PRODUCT_FILES_FOLDER,
  MAX_ARCHIVE_FILES,
  resolveStoragePath,
  productFileExtension,
  productFileUrl,
  parseProductFileUrl,
  productFileRef,
  productFileContentType,
  withAbsoluteProductFileUrls
};

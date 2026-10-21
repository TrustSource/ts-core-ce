import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {Meteor} from 'meteor/meteor';
import Products from '/imports/lib/collections/products';
import RestApi from './RestApi';
import Utils from '/imports/server/ServerUtils';
import {withAbsoluteProductFileUrls} from '/imports/server/storage/storagePaths';

const FETCH_LIMIT = 100;
const RESOURCE_NF = 'Resource not found: ';
const SCOPE_LIMITED = 'API-key scope is limited';

const READ_ROLES = ['developer', 'manager', 'compliance_manager', 'company_security_manager', 'portfolio_manager', 'account_admin'];
const WRITE_ROLES = ['developer', 'manager', 'compliance_manager', 'company_security_manager', 'account_admin'];
const RETIRE_ROLES = ['compliance_manager', 'company_security_manager', 'account_admin'];

// Fields a client may set through the update endpoint. Server-managed fields
// (companyId, demo, draft, submitted, released*, updated*, retired*) and the
// collection-managed sub-resources (solutions, supportContracts, misuses,
// documents) are intentionally excluded - the latter have dedicated endpoints.
const UPDATABLE_FIELDS = ['type', 'identifier', 'name', 'description', 'features',
  'state', 'classification', 'properties', 'contacts', 'parentId', 'started'];

// parentId is included so a client can reconstruct the product tree from the list.
const LIST_FIELDS = {type: 1, identifier: 1, name: 1, description: 1, state: 1,
  classification: 1, submitted: 1, released: 1, retired: 1, parentId: 1};

// Document slots on a product (ProductDocumentsSchema), excluding the photos array
// which has its own endpoint.
const DOCUMENT_TYPES = ['userManual', 'secureSetup', 'productDescription', 'sbom', 'cedoc'];

Router.route('/api/v2/core/products', {
  name: 'apiProductsRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false                // don't report page changes to google analytics
});

Router.route('/api/v2/core/products/:id', {
  name: 'apiProductRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/retire', {
  name: 'apiProductRetireRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/unretire', {
  name: 'apiProductUnretireRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/misuse', {
  name: 'apiProductMisuseRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/misuse/:itemId', {
  name: 'apiProductMisuseItemRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/support', {
  name: 'apiProductSupportRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/support/:itemId', {
  name: 'apiProductSupportItemRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/solution', {
  name: 'apiProductSolutionRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/solution/:approvalId', {
  name: 'apiProductSolutionItemRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false
});

Router.route('/api/v2/core/products/:id/photo', {
  name: 'apiProductPhotoRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false,
  onBeforeAction: RestApi.parseMultipartFile     // POST is multipart; DELETE/OPTIONS pass through
});

Router.route('/api/v2/core/products/:id/document', {
  name: 'apiProductDocumentRoute',
  where: 'server',
  action: RestApi.wrapAsync(handleProducts),
  trackPageView: false,
  onBeforeAction: RestApi.parseMultipartFile     // POST is multipart; DELETE/OPTIONS pass through
});

// (routeName, method) -> { op (log label), handler }. Logging the operation makes
// every product request identifiable in the logs (create vs update vs misuse, …).
const OPERATIONS = {
  apiProductsRoute: {
    GET: {op: 'products.list', handler: handleList},
    POST: {op: 'products.create', handler: handleCreate}
  },
  apiProductRoute: {
    GET: {op: 'products.get', handler: handleGetOne},
    POST: {op: 'products.update', handler: handleUpdate}
  },
  apiProductRetireRoute: {POST: {op: 'products.retire', handler: handleRetire}},
  apiProductUnretireRoute: {POST: {op: 'products.unretire', handler: handleUnretire}},
  apiProductMisuseRoute: {POST: {op: 'products.misuse.add', handler: handleAddMisuse}},
  apiProductMisuseItemRoute: {DELETE: {op: 'products.misuse.remove', handler: handleRemoveMisuse}},
  apiProductSupportRoute: {POST: {op: 'products.support.add', handler: handleAddSupport}},
  apiProductSupportItemRoute: {DELETE: {op: 'products.support.remove', handler: handleRemoveSupport}},
  apiProductSolutionRoute: {POST: {op: 'products.solution.link', handler: handleLinkSolution}},
  apiProductSolutionItemRoute: {DELETE: {op: 'products.solution.unlink', handler: handleUnlinkSolution}},
  apiProductPhotoRoute: {
    POST: {op: 'products.photo.upload', handler: handleUploadPhoto},
    DELETE: {op: 'products.photo.remove', handler: handleRemovePhoto}
  },
  apiProductDocumentRoute: {
    POST: {op: 'products.document.upload', handler: handleUploadDocument},
    DELETE: {op: 'products.document.remove', handler: handleRemoveDocument}
  }
};

async function handleProducts() {
  this.response.statusCode = 200;   // default OK
  this.response.setHeader('Content-Type', 'application/json');
  this.response.setHeader('Access-Control-Allow-Origin', '*');
  this.response.setHeader('Access-Control-Allow-Methods', '*');
  this.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token');

  if (this.request.method === 'OPTIONS') {
    handleOptions(this.response);
    return;
  }

  const routeOps = OPERATIONS[this.route.getName()];
  const entry = routeOps && routeOps[this.request.method];
  if (!entry) {
    RestApi.requestLogger(this.request, this.params, 'products');
    methodNotAllowed(this.response);
    return;
  }
  RestApi.requestLogger(this.request, this.params, entry.op);
  await entry.handler(this.request, this.params, this.response);
}

// --- shared helpers -------------------------------------------------------

// Resolve the API key, enforce scope. Returns {user, company, keyMeta} or null
// (having already written the 401/403 response).
async function authorize(request, response, roles) {
  const headers = request.headers || {};
  const body = request.body || {};
  const keyMetaAndCompany = await RestApi.getKeyMetaAndCompanyByAccountAndApiKey(headers['x-api-key'] || body.apiKey);
  if (keyMetaAndCompany.error) {
    response.statusCode = keyMetaAndCompany.statusCode;
    response.end(JSON.stringify(keyMetaAndCompany.error));
    return null;
  }
  if (!Utils.validateKeyScope(keyMetaAndCompany.keyMeta, roles)) {
    response.statusCode = 403;
    response.end(JSON.stringify(SCOPE_LIMITED));
    return null;
  }
  return keyMetaAndCompany;
}

// Strip $-prefixed (MongoDB operator) keys from a user-supplied object.
function sanitizeBody(body) {
  const safe = {};
  _.each(body || {}, function (value, key) {
    if (!key.startsWith('$')) {
      safe[key] = value;
    }
  });
  return safe;
}

// Reject non-string values for fields that reach a MongoDB query selector, so a
// body like {"identifier": {"$regex": "..."}} cannot inject query operators.
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function notFound(response, id) {
  response.statusCode = 404;
  response.end(JSON.stringify(RESOURCE_NF + id));
}

function badRequest(response, message) {
  response.statusCode = 400;
  response.end(JSON.stringify(message));
}

function endError(response, error, message) {
  response.statusCode = (error && error.error >= 400 && error.error < 600) ? error.error : 400;
  response.end(JSON.stringify(error && error.reason ? error.reason : message));
}

// Product files are stored with app-relative URLs; API callers get absolute ones.
function forResponse(product) {
  return withAbsoluteProductFileUrls(product, (path) => Meteor.absoluteUrl(path.replace(/^\//, '')));
}

// Confirm the product exists within the caller's company (returns the doc or null).
async function loadProduct(id, companyId, fields) {
  return Products.findOneAsync({_id: id, companyId}, fields ? {fields} : undefined);
}

// Re-fetch and return the product after a mutation.
async function respondWithProduct(response, id, companyId, statusCode) {
  const product = await Products.findOneAsync({_id: id, companyId});
  response.statusCode = statusCode || 200;
  response.end(JSON.stringify(forResponse(product)));
}

// --- product CRUD ---------------------------------------------------------

async function handleList(request, params, response) {
  const auth = await authorize(request, response, READ_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  response.setHeader('Cache-Control', 'no-cache, no-store');

  const query = {companyId};
  if (request.query.includeRetired !== 'true') {
    query.retired = {$in: [null]};
  }
  const page = request.query.page && +request.query.page > 0 ? +request.query.page - 1 : 0;
  const options = {limit: FETCH_LIMIT, skip: page * FETCH_LIMIT, fields: LIST_FIELDS, sort: {name: 1}};
  const products = await Products.find(query, options).fetchAsync();
  response.end(JSON.stringify(products));
}

async function handleGetOne(request, params, response) {
  const auth = await authorize(request, response, READ_ROLES);
  if (!auth) {
    return;
  }
  response.setHeader('Cache-Control', 'no-cache, no-store');
  const product = await loadProduct(params.id, auth.company._id);
  if (!product) {
    notFound(response, params.id);
    return;
  }
  response.end(JSON.stringify(forResponse(product)));
}

async function handleCreate(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const body = sanitizeBody(request.body);

  if (!isNonEmptyString(body.type) || !isNonEmptyString(body.identifier) || !isNonEmptyString(body.name)) {
    badRequest(response, 'Fields type, identifier and name are required and must be strings');
    return;
  }
  try {
    const newId = await Meteor.callAsync('Products.Create', {
      demo: body.demo === true,       // demo data only when explicitly requested (e.g. API tests); normal usage omits it
      draft: body.draft === true,
      type: body.type,
      identifier: body.identifier,
      name: body.name,
      description: body.description,
      properties: body.properties,
      parentId: body.parentId,
      companyId: auth.company._id,
      apiUser: auth.user
    });
    await respondWithProduct(response, newId, auth.company._id, 201);
  } catch (error) {
    endError(response, error, 'Error creating product');
  }
}

async function handleUpdate(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  const existing = await loadProduct(params.id, companyId, {_id: 1, identifier: 1});
  if (!existing) {
    notFound(response, params.id);
    return;
  }

  const body = sanitizeBody(request.body);
  const set = {};
  UPDATABLE_FIELDS.forEach(function (field) {
    if (body[field] !== undefined) {
      set[field] = body[field];
    }
  });
  if (_.isEmpty(set)) {
    badRequest(response, 'No updatable fields provided');
    return;
  }
  // identifier reaches a MongoDB query selector below - it must be a plain string
  if (set.identifier !== undefined && !isNonEmptyString(set.identifier)) {
    badRequest(response, 'identifier must be a non-empty string');
    return;
  }
  // identifier is the product's external key - enforce uniqueness within the
  // company on change. Scope the check to companyId (matching Products.Create)
  // so it cannot probe whether another tenant already uses a given identifier.
  if (set.identifier !== undefined && set.identifier !== existing.identifier) {
    const dup = await Products.findOneAsync({identifier: set.identifier, companyId}, {fields: {_id: 1}});
    if (dup && dup._id !== params.id) {
      badRequest(response, 'Product with same identifier already exists: ' + set.identifier);
      return;
    }
  }
  try {
    await Meteor.callAsync('Products.Update', {$set: set}, params.id, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error updating product');
  }
}

// --- retire / un-retire ---------------------------------------------------

async function handleRetire(request, params, response) {
  const auth = await authorize(request, response, RETIRE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  const existing = await Products.findOneAsync({_id: params.id, companyId, retired: {$in: [null]}}, {fields: {_id: 1}});
  if (!existing) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  const set = {retired: new Date(), retiredBy: auth.user._id, retiredByName: auth.user.profile.name};
  if (typeof body.retiredReason === 'string') {
    set.retiredReason = body.retiredReason;
  }
  try {
    await Meteor.callAsync('Products.Update', {$set: set}, params.id, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error retiring product');
  }
}

async function handleUnretire(request, params, response) {
  const auth = await authorize(request, response, RETIRE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  const existing = await loadProduct(params.id, companyId, {_id: 1});
  if (!existing) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  const set = {retired: null, retiredBy: auth.user._id, retiredByName: auth.user.profile.name};
  if (typeof body.retiredReason === 'string') {
    set.retiredReason = body.retiredReason;
  }
  try {
    await Meteor.callAsync('Products.Update', {$set: set}, params.id, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error un-retiring product');
  }
}

// --- misuses --------------------------------------------------------------

async function handleAddMisuse(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  if (!isNonEmptyString(body.name)) {
    badRequest(response, 'Misuse name is required and must be a string');
    return;
  }
  // Build from explicit scalar fields only - never the raw body. Products.MisuseCreate
  // stamps _id and created.
  const misuse = {name: body.name};
  if (typeof body.description === 'string') {
    misuse.description = body.description;
  }
  try {
    await Meteor.callAsync('Products.MisuseCreate', {product: {_id: params.id}, misuse}, auth.user);
    await respondWithProduct(response, params.id, companyId, 201);
  } catch (error) {
    endError(response, error, 'Error adding misuse');
  }
}

async function handleRemoveMisuse(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  try {
    await Meteor.callAsync('Products.MisuseRemove', {product: {_id: params.id}, misuse: {_id: params.itemId}}, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error removing misuse');
  }
}

// --- support contracts ----------------------------------------------------

async function handleAddSupport(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  if (!isNonEmptyString(body.name)) {
    badRequest(response, 'Support contract name is required and must be a string');
    return;
  }
  // Products.SupportCreate stamps _id and created.
  const support = {name: body.name};
  if (typeof body.description === 'string') {
    support.description = body.description;
  }
  if (body.endDate !== undefined) {
    const endDate = new Date(body.endDate);
    if (isNaN(endDate.getTime())) {
      badRequest(response, 'endDate must be a valid date');
      return;
    }
    support.endDate = endDate;
  }
  try {
    await Meteor.callAsync('Products.SupportCreate', {product: {_id: params.id}, support}, auth.user);
    await respondWithProduct(response, params.id, companyId, 201);
  } catch (error) {
    endError(response, error, 'Error adding support contract');
  }
}

async function handleRemoveSupport(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  try {
    await Meteor.callAsync('Products.SupportRemove', {product: {_id: params.id}, support: {_id: params.itemId}}, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error removing support contract');
  }
}

// --- solutions (release links) --------------------------------------------

async function handleLinkSolution(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  if (!isNonEmptyString(body.approvalId) || !isNonEmptyString(body.name)) {
    badRequest(response, 'Fields approvalId and name are required and must be strings');
    return;
  }
  // Products.LinkWithRelease resolves the approval's capabilities and $addToSet the
  // solution. Build the approval from explicit scalar fields only.
  const approval = {_id: body.approvalId, name: body.name};
  if (typeof body.version === 'string') {
    approval.version = body.version;
  }
  if (typeof body.closedByName === 'string') {
    approval.closedByName = body.closedByName;
  }
  try {
    await Meteor.callAsync('Products.LinkWithRelease', {product: {_id: params.id}, approval}, auth.user);
    await respondWithProduct(response, params.id, companyId, 201);
  } catch (error) {
    endError(response, error, 'Error linking release');
  }
}

async function handleUnlinkSolution(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  try {
    await Meteor.callAsync('Products.UnlinkWithRelease', {product: {_id: params.id}, approval: {_id: params.approvalId}}, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error unlinking release');
  }
}

// --- photos & documents (base64 content) ----------------------------------

// Read the uploaded file from a multipart-parsed body (RestApi.parseMultipartFile).
// Returns {fileName, fileExtension, mimeType, data} or writes a 400 and returns null.
function readMultipartFile(body, response) {
  const data = body && body.documentContent;
  if (!Buffer.isBuffer(data) || !data.length) {
    badRequest(response, 'A multipart "file" part is required');
    return null;
  }
  const fileName = body.filename;
  if (!isNonEmptyString(fileName)) {
    badRequest(response, 'Uploaded file must have a filename');
    return null;
  }
  const dot = fileName.lastIndexOf('.');
  const fileExtension = dot > -1 ? fileName.slice(dot + 1).toLowerCase() : '';
  if (!fileExtension) {
    badRequest(response, 'Uploaded filename must include an extension');
    return null;
  }
  return {fileName, fileExtension, mimeType: body.mimeType || 'application/octet-stream', data};
}

async function handleUploadPhoto(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const file = readMultipartFile(request.body, response);
  if (!file) {
    return;
  }
  try {
    await Meteor.callAsync('Products.PictureUpload', {product: {_id: params.id}, file}, auth.user);
    await respondWithProduct(response, params.id, companyId, 201);
  } catch (error) {
    endError(response, error, 'Error uploading photo');
  }
}

async function handleRemovePhoto(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  if (!isNonEmptyString(body.url)) {
    badRequest(response, 'Field url is required and must be a string');
    return;
  }
  try {
    await Meteor.callAsync('Products.PictureRemove', {product: {_id: params.id}, file: {url: body.url}}, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error removing photo');
  }
}

async function handleUploadDocument(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const documentType = request.body && request.body.documentType;
  if (DOCUMENT_TYPES.indexOf(documentType) === -1) {
    badRequest(response, 'documentType must be one of: ' + DOCUMENT_TYPES.join(', '));
    return;
  }
  const file = readMultipartFile(request.body, response);
  if (!file) {
    return;
  }
  file.documentType = documentType;
  try {
    await Meteor.callAsync('Products.DocumentUpload', {product: {_id: params.id}, file}, auth.user);
    await respondWithProduct(response, params.id, companyId, 201);
  } catch (error) {
    endError(response, error, 'Error uploading document');
  }
}

async function handleRemoveDocument(request, params, response) {
  const auth = await authorize(request, response, WRITE_ROLES);
  if (!auth) {
    return;
  }
  const companyId = auth.company._id;
  if (!await loadProduct(params.id, companyId, {_id: 1})) {
    notFound(response, params.id);
    return;
  }
  const body = sanitizeBody(request.body);
  if (DOCUMENT_TYPES.indexOf(body.documentType) === -1) {
    badRequest(response, 'documentType must be one of: ' + DOCUMENT_TYPES.join(', '));
    return;
  }
  if (!isNonEmptyString(body.url)) {
    badRequest(response, 'Field url is required and must be a string');
    return;
  }
  try {
    await Meteor.callAsync('Products.DocumentRemove', {product: {_id: params.id}, documentType: body.documentType, file: {url: body.url}}, auth.user);
    await respondWithProduct(response, params.id, companyId);
  } catch (error) {
    endError(response, error, 'Error removing document');
  }
}

// --- OPTIONS / 405 --------------------------------------------------------

function handleOptions(response) {
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.end();
}

function methodNotAllowed(response) {
  response.statusCode = 405;
  response.end(JSON.stringify('Method Not Allowed'));
}

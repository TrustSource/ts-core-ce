/* eslint-disable no-undef */
// Product documents and photos live on a shared volume. An upload or removal must pass the
// product write role check and resolve its product inside the caller's company BEFORE any
// file is stored or removed: a file written for a refused write, or for a product that does
// not exist, stays on the volume as an orphan, and a removal must not delete a file for a
// write that is then refused. A call naming neither the product _id nor its identifier used
// to fall back to "any product of the company".
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const paths = require('../../imports/server/storage/storagePaths');

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const COMPANY = 'CompanyAAAAAAAAAA';
const OTHER = 'CompanyBBBBBBBBBB';
const UUID = '0b7e4a1c-2f6d-4b8e-9a3c-5d1e7f9a2b4c';
const OWN_PDF = paths.productFileUrl(COMPANY, `${UUID}.pdf`);
const OWN_PNG = paths.productFileUrl(COMPANY, `${UUID}.png`);
const PRODUCT = {
  _id: 'ProductP1', companyId: COMPANY, identifier: 'prod-1', name: 'Product',
  documents: {userManual: {url: OWN_PDF}}, solutions: [{_id: 'Approval1'}]
};
const SESSION_USER = {_id: 'user1', profile: {companyId: COMPANY}};
const API_USER = {_id: 'apiUser1', profile: {companyId: COMPANY}};

function matches(doc, filter) {
  return Object.keys(filter).every((key) => doc[key] === filter[key]);
}

function check(value, pattern) {
  let ok = true;
  if (pattern === String) {
    ok = typeof value === 'string';
  } else if (pattern === Object) {
    ok = value !== null && typeof value === 'object';
  }
  if (!ok) {
    throw new FakeMeteorError(400, 'Match failed');
  }
}

function world({sessionUser = SESSION_USER, hasRole = true, products = [PRODUCT]} = {}) {
  const w = {};
  w.Meteor = {
    Error: FakeMeteorError,
    userAsync: jest.fn(async () => sessionUser),
    callAsync: jest.fn(async () => undefined)
  };
  w.Roles = {userIsInRole: jest.fn(async () => hasRole)};
  w.Products = {
    findOneAsync: jest.fn(async (filter) => products.find((p) => matches(p, filter)) || undefined),
    updateAsync: jest.fn(async () => 1)
  };
  w.files = {
    storeProductFile: jest.fn(async ({companyId, extension}) => paths.productFileUrl(companyId, `${UUID}.${extension}`)),
    removeProductFile: jest.fn(async ({companyId, url}) => {
      if (!paths.productFileRef(url, companyId)) {
        throw new FakeMeteorError(400, 'URL does not name one of your product files');
      }
    }),
    removeProductFileIfOwned: jest.fn(async () => true)
  };
  w.update = jest.fn(async () => 1);
  w.access = loadMeteorModule('imports/lib/interactors/products/productAccess.js', {
    'meteor/meteor': {Meteor: w.Meteor},
    'meteor/alanning:roles': {Roles: w.Roles},
    '/imports/lib/collections/products': w.Products
  });
  const common = {
    'meteor/meteor': {Meteor: w.Meteor},
    'meteor/check': {check},
    '/imports/lib/collections/products': w.Products,
    '/imports/lib/utils': {username: () => 'User One'},
    './update': w.update,
    './productAccess': w.access,
    '/imports/server/storage/productFiles': w.files,
    '/imports/server/storage/storagePaths': paths
  };
  w.load = (name, extra) => loadMeteorModule(`imports/lib/interactors/products/${name}.js`,
    Object.assign({}, common, extra || {})).default;
  w.sbomDeps = {
    '/imports/lib/collections/companies': {findOneAsync: jest.fn(async () => ({_id: COMPANY}))},
    '/imports/lib/collections/sbomFiles': {findOneAsync: jest.fn(async () => ({_id: 'Sbom1'}))},
    '/imports/lib/collections/approves': {findOneAsync: jest.fn(async () => ({sbomFileId: 'Sbom1'}))},
    '/imports/lib/reports/reportSbomFileService': {getCycloneDxDetails: () => ({bomFormat: 'CycloneDX'})},
    '../../converter/merge-cydx': async () => ({bomFormat: 'CycloneDX', components: []})
  };
  return w;
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

// Each interactor with valid props for a given product reference.
const INTERACTORS = [
  ['document-upload', (product) => ({product, file: {fileExtension: 'pdf', data: [37, 80], fileName: 'manual.pdf', documentType: 'userManual'}})],
  ['picture-upload', (product) => ({product, file: {fileExtension: 'png', data: [137, 80], fileName: 'photo.png'}})],
  ['sbom-generate', (product) => ({product})],
  ['document-remove', (product) => ({product, documentType: 'userManual', file: {url: OWN_PDF}})],
  ['picture-remove', (product) => ({product, file: {url: OWN_PNG}})]
];

function run(w, name, props, apiUser) {
  const interactor = w.load(name, name === 'sbom-generate' ? w.sbomDeps : undefined);
  return interactor(props, apiUser);
}

function expectNoFileTouched(w) {
  expect(w.files.storeProductFile).not.toHaveBeenCalled();
  expect(w.files.removeProductFile).not.toHaveBeenCalled();
  expect(w.files.removeProductFileIfOwned).not.toHaveBeenCalled();
  expect(w.update).not.toHaveBeenCalled();
}

function fileTouchCount(w) {
  return w.files.storeProductFile.mock.calls.length + w.files.removeProductFile.mock.calls.length;
}

describe.each(INTERACTORS)('products/%s', (name, propsFor) => {
  it('refuses a session user without a product write role before touching any file', async () => {
    const w = world({hasRole: false});
    const error = await caught(run(w, name, propsFor({_id: PRODUCT._id})));
    expect(error.error).toBe(403);
    expect(w.Products.findOneAsync).not.toHaveBeenCalled();
    expectNoFileTouched(w);
  });

  it('refuses a call without a session user or an API user', async () => {
    const w = world({sessionUser: null});
    const error = await caught(run(w, name, propsFor({_id: PRODUCT._id})));
    expect(error.error).toBe(403);
    expectNoFileTouched(w);
  });

  it('answers 404 for a product that is not in the caller\'s company, before touching any file', async () => {
    const w = world({products: [Object.assign({}, PRODUCT, {companyId: OTHER})]});
    const error = await caught(run(w, name, propsFor({_id: PRODUCT._id})));
    expect(error.error).toBe(404);
    expect(w.Products.findOneAsync.mock.calls[0][0]).toEqual({companyId: COMPANY, _id: PRODUCT._id});
    expectNoFileTouched(w);
  });

  it.each([
    ['neither _id nor identifier', {}],
    ['no product at all', undefined],
    ['an operator object as _id', {_id: {$ne: null}}],
    ['an operator object as identifier', {identifier: {$gt: ''}}]
  ])('answers 400 for %s without looking up a product or touching any file', async (label, product) => {
    const w = world();
    const error = await caught(run(w, name, propsFor(product)));
    expect(error.error).toBe(400);
    expect(w.Products.findOneAsync).not.toHaveBeenCalled();
    expectNoFileTouched(w);
  });

  it('changes the file of a resolved product for a session user with a write role', async () => {
    const w = world();
    await run(w, name, propsFor({_id: PRODUCT._id}));
    expect(w.Roles.userIsInRole).toHaveBeenCalledWith(SESSION_USER._id, expect.arrayContaining(['account_admin']), COMPANY);
    expect(fileTouchCount(w)).toBe(1);
    expect(w.update).toHaveBeenCalledTimes(1);
    expect(w.update.mock.calls[0][1]).toBe(PRODUCT._id);
    expect(w.update.mock.calls[0][2]).toBe(SESSION_USER);
  });

  it('resolves the product by identifier within the caller\'s company', async () => {
    const w = world();
    await run(w, name, propsFor({identifier: PRODUCT.identifier}));
    expect(w.Products.findOneAsync.mock.calls[0][0]).toEqual({companyId: COMPANY, identifier: PRODUCT.identifier});
    expect(w.update.mock.calls[0][1]).toBe(PRODUCT._id);
  });

  it('keeps trusting the API user a REST handler passes when there is no session', async () => {
    const w = world({sessionUser: null, hasRole: false});
    await run(w, name, propsFor({_id: PRODUCT._id}), API_USER);
    expect(w.Roles.userIsInRole).not.toHaveBeenCalled();
    expect(fileTouchCount(w)).toBe(1);
    expect(w.update.mock.calls[0][2]).toBe(API_USER);
  });
});

describe('products/picture-remove URL checks', () => {
  it('answers 400 for a URL that is not a string, before removing anything', async () => {
    const w = world();
    const error = await caught(run(w, 'picture-remove', {product: {_id: PRODUCT._id}, file: {url: {$ne: null}}}));
    expect(error.error).toBe(400);
    expectNoFileTouched(w);
  });

  it('answers 400 for a URL that is not one of the caller\'s product files and leaves the product alone', async () => {
    const w = world();
    const foreign = paths.productFileUrl(OTHER, `${UUID}.png`);
    const error = await caught(run(w, 'picture-remove', {product: {_id: PRODUCT._id}, file: {url: foreign}}));
    expect(error.error).toBe(400);
    expect(w.update).not.toHaveBeenCalled();
  });

  it('pulls the stored relative URL when an API caller sends the absolute one', async () => {
    const w = world({sessionUser: null});
    await run(w, 'picture-remove', {product: {_id: PRODUCT._id}, file: {url: `https://ts.example${OWN_PNG}`}}, API_USER);
    expect(w.update.mock.calls[0][0]).toEqual({$pull: {'documents.photos': {url: OWN_PNG}}});
  });
});

describe('products/update keeps the same role check', () => {
  function loadUpdate(w) {
    return loadMeteorModule('imports/lib/interactors/products/update.js', {
      'meteor/meteor': {Meteor: w.Meteor},
      '/imports/lib/utils': {username: () => 'User One'},
      '/imports/lib/collections/products': w.Products,
      '/imports/lib/security/sanitizeModifier': {sanitizeModifier: (modifier) => modifier},
      './productAccess': w.access
    }).default;
  }

  it('refuses a session user without a write role', async () => {
    const w = world({hasRole: false});
    const error = await caught(loadUpdate(w)({$set: {name: 'x'}}, PRODUCT._id));
    expect(error.error).toBe(403);
    expect(w.Products.updateAsync).not.toHaveBeenCalled();
  });

  it('updates within the caller\'s company for a session user with a write role or an API user', async () => {
    for (const w of [world(), world({sessionUser: null, hasRole: false})]) {
      await loadUpdate(w)({$set: {name: 'x'}}, PRODUCT._id, API_USER);
      expect(w.Products.updateAsync.mock.calls[0][0]).toEqual({_id: PRODUCT._id, companyId: COMPANY});
    }
  });

  it('the role list lives only in productAccess', () => {
    const update = readSourceWithoutComments('imports/lib/interactors/products/update.js');
    expect(update).not.toMatch(/compliance_manager/);
    expect(update).toMatch(/resolveProductWriter\(\s*apiUser\s*\)/);
    const access = readSourceWithoutComments('imports/lib/interactors/products/productAccess.js');
    expect(access).toMatch(/export const PRODUCT_WRITE_ROLES = \['developer', 'compliance_manager', 'company_security_manager',\s*'account_admin'\]/);
  });
});

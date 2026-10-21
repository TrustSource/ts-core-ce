/* eslint-disable no-undef */
// GET /files/products/:companyId/:name serves product documents and photos to members of
// the owning company only (productFileAccess.js decides who that is). It must never render
// them on the app origin: attachment, nosniff and a sandbox CSP on every file.
const {Readable, PassThrough} = require('stream');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
const paths = require('../../imports/server/storage/storagePaths');

const COMPANY = 'CompanyAAAAAAAAAA';
const NAME = '0b7e4a1c-2f6d-4b8e-9a3c-5d1e7f9a2b4c.png';

function load(files, openReadStream, readerCompany = COMPANY) {
  const routes = {};
  const mod = loadMeteorModule('imports/server/storage/productFilesRoute.js', {
    'meteor/vlasky:galvanized-iron-router': {Router: {route: (path, options) => { routes[path] = options; }}},
    'stream': require('stream'),
    '/imports/server/storage/storagePaths': paths,
    '/imports/server/storage/productFileAccess': {companyOfFileReader: async () => readerCompany},
    '/imports/server/storage/fileStorage': {
      statFile: async (ref) => {
        if (!paths.resolveStoragePath('/root', ref.companyId, ref.folder, ref.name)) {
          const error = new Error('Invalid file reference');
          error.error = 400;
          throw error;
        }
        const body = files[`${ref.companyId}/${ref.name}`];
        return body === undefined ? null : {size: Buffer.byteLength(body)};
      },
      openReadStream: openReadStream || ((ref) => Readable.from([Buffer.from(files[`${ref.companyId}/${ref.name}`])]))
    }
  });
  return {mod, routes};
}

function response() {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  out.writeHead = function (status, headers) { this.status = status; this.headers = headers || {}; };
  out.body = () => Buffer.concat(chunks).toString('utf8');
  return out;
}

function finished(res) {
  return new Promise((resolve) => res.on('finish', resolve));
}

describe('product file route', () => {
  it('registers a server route under /files/products', () => {
    const {routes} = load({});
    expect(routes['/files/products/:companyId/:name'].where).toBe('server');
  });

  it('streams a stored file with safe download headers', async () => {
    const {mod} = load({[`${COMPANY}/${NAME}`]: 'PNGDATA'});
    const res = response();
    const done = finished(res);
    await mod.serveProductFile({method: 'GET'}, res, {companyId: COMPANY, name: NAME});
    await done;
    expect(res.status).toBe(200);
    expect(res.body()).toBe('PNGDATA');
    expect(res.headers).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Length': 7,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'private, max-age=31536000, immutable'
    });
    expect(res.headers['Content-Disposition']).toBe(`attachment; filename="${NAME}"`);
  });

  it.each([
    ['a missing file', {companyId: COMPANY, name: NAME}],
    ['an invalid name', {companyId: COMPANY, name: '../../etc/passwd'}],
    ['an invalid company', {companyId: '..', name: NAME}]
  ])('answers 404 for %s', async (label, params) => {
    const {mod} = load({});
    const res = response();
    await mod.serveProductFile({method: 'GET'}, res, params);
    expect(res.status).toBe(404);
  });

  it.each([
    ['an anonymous caller', null],
    ['a member of another company', 'CompanyBBBBBBBBBB']
  ])('answers 404 to %s', async (label, readerCompany) => {
    const {mod} = load({[`${COMPANY}/${NAME}`]: 'PNGDATA'}, undefined, readerCompany);
    const res = response();
    await mod.serveProductFile({method: 'GET'}, res, {companyId: COMPANY, name: NAME});
    expect(res.status).toBe(404);
    expect(res.body()).not.toContain('PNGDATA');
  });

  it('answers 405 for anything but GET and HEAD', async () => {
    const {mod} = load({[`${COMPANY}/${NAME}`]: 'PNGDATA'});
    const res = response();
    await mod.serveProductFile({method: 'POST'}, res, {companyId: COMPANY, name: NAME});
    expect(res.status).toBe(405);
  });

  it('destroys the source stream when the response is aborted mid-download', async () => {
    const source = new PassThrough();
    const {mod} = load({[`${COMPANY}/${NAME}`]: 'PNGDATA'}, () => source);
    const res = response();
    await mod.serveProductFile({method: 'GET'}, res, {companyId: COMPANY, name: NAME});
    source.write('partial-chunk');
    expect(source.destroyed).toBe(false);
    res.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(source.destroyed).toBe(true);
  });
});

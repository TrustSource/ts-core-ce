/* eslint-disable no-undef */
// Product documents and photos live on local storage (CE replaced S3). The "download
// all" archive must never fetch a client-sent URL: a URL is accepted only as the name
// of one of the caller's own product files, which is then read from disk.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
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
const own = (ext) => paths.productFileUrl(COMPANY, `${UUID}.${ext}`);

function load() {
  const disk = new Map();
  const key = (ref) => `${ref.companyId}/${ref.folder}/${ref.name}`;
  const zipped = [];
  const fetch = jest.fn(async () => {
    throw new Error('fetch must never be called');
  });
  const mod = loadMeteorModule('imports/server/storage/productFiles.js', {
    'meteor/meteor': {Meteor: {Error: FakeMeteorError}},
    'uuid': {v4: () => UUID},
    'jszip': class {
      file(name, data) { zipped.push({name, data}); }
      async generateAsync() { return 'ZIP-BASE64'; }
    },
    '/imports/server/storage/storagePaths': paths,
    '/imports/server/storage/fileStorage': {
      putFile: async (ref) => { disk.set(key(ref), ref.data); },
      readBuffer: async (ref) => disk.has(key(ref)) ? Buffer.from(disk.get(key(ref))) : null,
      removeFile: async (ref) => { disk.delete(key(ref)); }
    }
  }, {globals: {Buffer, fetch}});
  return {mod, disk, zipped, fetch};
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('storeProductFile', () => {
  it('stores <uuid>.<ext> under the company folder and returns the app-relative URL', async () => {
    const world = load();
    const url = await world.mod.storeProductFile({companyId: COMPANY, extension: 'PDF', data: [37, 80, 68, 70]});
    expect(url).toBe(own('pdf'));
    expect(world.disk.has(`${COMPANY}/product-files/${UUID}.pdf`)).toBe(true);
  });

  it('refuses an extension the guard rejects', async () => {
    const world = load();
    const error = await caught(world.mod.storeProductFile({companyId: COMPANY, extension: '../html', data: 'x'}));
    expect(error.error).toBe(400);
    expect(world.disk.size).toBe(0);
  });
});

describe('removeProductFile / removeProductFileIfOwned', () => {
  it('removes one of the caller\'s files', async () => {
    const world = load();
    const url = await world.mod.storeProductFile({companyId: COMPANY, extension: 'pdf', data: 'x'});
    await world.mod.removeProductFile({companyId: COMPANY, url});
    expect(world.disk.size).toBe(0);
  });

  it('refuses another company\'s file with 400', async () => {
    const world = load();
    const error = await caught(world.mod.removeProductFile({companyId: OTHER, url: own('pdf')}));
    expect(error.error).toBe(400);
  });

  it('removeProductFileIfOwned skips a foreign or invalid URL without throwing', async () => {
    const world = load();
    expect(await world.mod.removeProductFileIfOwned({companyId: OTHER, url: own('pdf')})).toBe(false);
    expect(await world.mod.removeProductFileIfOwned({companyId: COMPANY, url: 'https://evil.example/x'})).toBe(false);
  });
});

describe('buildProductFilesArchive', () => {
  it('zips the caller\'s files from disk and never fetches', async () => {
    const world = load();
    const pdf = await world.mod.storeProductFile({companyId: COMPANY, extension: 'pdf', data: 'a'});
    const result = await world.mod.buildProductFilesArchive({companyId: COMPANY, fileUrls: [pdf]});
    expect(result.base64).toBe('ZIP-BASE64');
    expect(result.fileName).toMatch(/^archive-\d+\.zip$/);
    expect(world.zipped.map((f) => f.name)).toEqual([`${UUID}.pdf`]);
    expect(world.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a loopback URL', ['http://127.0.0.1:3000/healthcheck']],
    ['another company\'s file', [paths.productFileUrl(OTHER, `${UUID}.pdf`)]],
    ['no files', []],
    ['not an array', 'x'],
    ['too many files', Array.from({length: 51}, () => own('pdf'))]
  ])('refuses %s with 400 before reading anything', async (label, fileUrls) => {
    const world = load();
    const error = await caught(world.mod.buildProductFilesArchive({companyId: COMPANY, fileUrls}));
    expect(error.error).toBe(400);
    expect(world.zipped).toHaveLength(0);
  });

  it('answers 400 when a listed file is missing on disk', async () => {
    const world = load();
    const error = await caught(world.mod.buildProductFilesArchive({companyId: COMPANY, fileUrls: [own('pdf')]}));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('Failed to download file');
  });
});

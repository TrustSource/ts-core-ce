/* eslint-disable no-undef */
// fileStorage keeps CE files on the local (shared) volume. It must write atomically
// (a reader on another container never sees half a file), report a missing file as
// null instead of throwing, and refuse any reference the path guard rejects.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const COMPANY = 'CompanyAAAAAAAAAA';
const NOTICE = {companyId: COMPANY, folder: 'notice-files', name: '1726560000000.json'};

function load(root) {
  return loadMeteorModule('imports/server/storage/fileStorage.js', {
    'meteor/meteor': {Meteor: {Error: FakeMeteorError}},
    'fs': fs,
    'path': path,
    'crypto': require('crypto'),
    '/imports/config': {Config: {METEOR_UPLOAD_FOLDER: root}},
    '/imports/server/storage/storagePaths': require('../../imports/server/storage/storagePaths')
  }, {globals: {Buffer}});
}

describe('fileStorage', () => {
  let root;
  let storage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-files-'));
    storage = load(root);
  });

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('writes a file under <root>/<company>/<folder>/<name> and reads it back', async () => {
    await storage.putFile(Object.assign({data: JSON.stringify({licenses: [1]})}, NOTICE));
    expect(fs.readFileSync(path.join(root, COMPANY, 'notice-files', NOTICE.name), 'utf8')).toBe('{"licenses":[1]}');
    expect(await storage.readJson(NOTICE)).toEqual({licenses: [1]});
    expect((await storage.readBuffer(NOTICE)).toString('utf8')).toBe('{"licenses":[1]}');
  });

  it('leaves no temp files behind and replaces an existing file', async () => {
    await storage.putFile(Object.assign({data: 'one'}, NOTICE));
    await storage.putFile(Object.assign({data: 'two'}, NOTICE));
    expect(fs.readdirSync(path.join(root, COMPANY, 'notice-files'))).toEqual([NOTICE.name]);
    expect((await storage.readBuffer(NOTICE)).toString('utf8')).toBe('two');
  });

  it('reports a missing file as null', async () => {
    expect(await storage.readBuffer(NOTICE)).toBeNull();
    expect(await storage.readJson(NOTICE)).toBeNull();
    expect(await storage.statFile(NOTICE)).toBeNull();
  });

  it('reports invalid JSON as null', async () => {
    await storage.putFile(Object.assign({data: '{not json'}, NOTICE));
    expect(await storage.readJson(NOTICE)).toBeNull();
  });

  it('removes a file and tolerates removing it twice', async () => {
    await storage.putFile(Object.assign({data: 'x'}, NOTICE));
    await storage.removeFile(NOTICE);
    await storage.removeFile(NOTICE);
    expect(await storage.statFile(NOTICE)).toBeNull();
  });

  it('streams a stored file', async () => {
    await storage.putFile(Object.assign({data: 'streamed'}, NOTICE));
    const chunks = [];
    for await (const chunk of storage.openReadStream(NOTICE)) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('streamed');
  });

  it('refuses a reference the guard rejects, before touching the disk', async () => {
    const bad = {companyId: COMPANY, folder: 'notice-files', name: '../../escape.json'};
    await expect(storage.putFile(Object.assign({data: 'x'}, bad))).rejects.toMatchObject({error: 400});
    await expect(storage.readBuffer(bad)).rejects.toMatchObject({error: 400});
    expect(() => storage.openReadStream(bad)).toThrow(FakeMeteorError);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

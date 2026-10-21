/* eslint-disable no-undef */
// Module import files live on the storage volume under <root>/moduleImports/. Their documents
// used to be client-writable (ModuleImports.allow insert/update for the uploader), so a client
// could point `versions.original.path` at any file on the server: the import pipeline read it
// and the /cdn/storage download served it. And ModuleImports.ImportModule checked that the
// caller owns the target project, but not that the file belongs to it, so another company's
// upload could be imported by id. These specs pin all four closures:
//   - readImportFileContent only reads a path inside the upload directory
//   - the download callback refuses a document whose file path points outside it
//   - ImportModule only imports a file uploaded for the project it names
//   - clients can no longer insert, update or remove ModuleImports documents directly
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
const MEMBER = {_id: 'member1', profile: {companyId: COMPANY}};

function loadCollection(root, projects) {
  let config = null;
  class FilesCollection {
    constructor(options) {
      config = options;
    }
  }
  const mod = loadMeteorModule('imports/lib/collections/moduleImports.js', {
    'meteor/meteor': {Meteor: {isServer: true}},
    'meteor/ostrio:files': {FilesCollection},
    '/imports/config': {Config: {METEOR_UPLOAD_FOLDER: root}},
    '/imports/lib/collections/projects': {findOneAsync: async (id) => projects[id]},
    '/imports/lib/files/downloadHeaders': {attachmentResponseHeaders: () => ({})}
  }, {globals: {require}});
  return {mod, config};
}

describe('ModuleImports file paths stay inside the upload directory', () => {
  let root;
  let uploadDir;
  let collection;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-imports-'));
    uploadDir = path.join(root, 'moduleImports');
    fs.mkdirSync(uploadDir);
    fs.mkdirSync(path.join(root, 'moduleImportsEvil'));
    fs.writeFileSync(path.join(uploadDir, 'upload.json'), '{"ok":true}');
    fs.writeFileSync(path.join(root, 'secret.json'), '{"secret":true}');
    fs.writeFileSync(path.join(root, 'moduleImportsEvil', 'x.json'), '{"secret":true}');
    collection = loadCollection(root, {Project1: {_id: 'Project1', companyId: COMPANY}});
  });

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  const ref = (filePath) => ({meta: {projectId: 'Project1'}, versions: {original: {path: filePath}}});

  it('reads an uploaded file inside the upload directory', async () => {
    const content = await collection.mod.readImportFileContent(ref(path.join(uploadDir, 'upload.json')));
    expect(content).toBe('{"ok":true}');
  });

  it.each([
    ['a file outside the storage root', () => '/etc/hosts'],
    ['a sibling file under the storage root', () => path.join(root, 'secret.json')],
    ['a traversal out of the upload directory', () => path.join(uploadDir, '..', 'secret.json')],
    ['a sibling directory sharing the name prefix', () => path.join(root, 'moduleImportsEvil', 'x.json')],
    ['the upload directory itself', () => uploadDir],
    ['a relative path', () => 'upload.json'],
    ['a non-string path', () => ({toString: () => '/etc/hosts'})]
  ])('refuses %s', async (label, target) => {
    await expect(collection.mod.readImportFileContent(ref(target()))).resolves.toBeNull();
  });

  describe('download authorization', () => {
    const member = {userId: MEMBER._id, userAsync: async () => MEMBER};

    it('serves a project member a file inside the upload directory', async () => {
      const result = await collection.config.protected.call(member, ref(path.join(uploadDir, 'upload.json')));
      expect(result).toBe(true);
    });

    it('refuses a project member a document whose original file path is outside it', async () => {
      const result = await collection.config.protected.call(member, ref(path.join(root, 'secret.json')));
      expect(result).toBe(403);
    });

    it('refuses a document with any version path outside it', async () => {
      const fileRef = ref(path.join(uploadDir, 'upload.json'));
      fileRef.versions.thumbnail = {path: '/etc/hosts'};
      const result = await collection.config.protected.call(member, fileRef);
      expect(result).toBe(403);
    });

    it('still refuses a user of another company', async () => {
      const outsider = {userId: 'other', userAsync: async () => ({_id: 'other', profile: {companyId: 'CompanyBBBBBBBBBB'}})};
      const result = await collection.config.protected.call(outsider, ref(path.join(uploadDir, 'upload.json')));
      expect(result).toBe(403);
    });
  });
});

describe('ModuleImports.ImportModule imports only a file uploaded for the named project', () => {
  function load({caller, files}) {
    const methods = {};
    const collection = {
      findOneAsync: jest.fn(async (id) => files[id]),
      updateAsync: jest.fn(async () => 1)
    };
    const readImportFileContent = jest.fn(async () => null);
    const ownedProjects = [{_id: 'Project1', companyId: COMPANY}];
    loadMeteorModule('imports/startup/server/moduleImports.js', {
      'meteor/meteor': {Meteor: {
        methods: (defined) => Object.assign(methods, defined),
        userAsync: async () => caller,
        users: {findOneAsync: async () => null},
        Error: FakeMeteorError
      }},
      '/imports/server/rest-api/ImportConverter': {},
      '/imports/lib/collections/moduleImports': {default: {collection}, readImportFileContent},
      '/imports/lib/collections/projects': {
        findOneAsync: async (query) => ownedProjects.find((p) => p._id === query._id && p.companyId === query.companyId)
      },
      '/imports/lib/collections/companies': {},
      '/imports/server/rest-api/apiSchema': {helpers: {}},
      '/imports/server/rest-api/RestApi': {},
      '/imports/server/rest-api/scans': {},
      '/imports/lib/spdx/detectFormat': () => 'json'
    }, {allowNoExports: true});
    return {importModule: methods['ModuleImports.ImportModule'], collection, readImportFileContent};
  }

  const OWN_FILE = {_id: 'File1', meta: {projectId: 'Project1', type: 'cyclonedx'}};
  const FOREIGN_FILE = {_id: 'File2', meta: {projectId: 'ProjectOfAnotherCompany', type: 'cyclonedx'}};
  const FILES = {File1: OWN_FILE, File2: FOREIGN_FILE};

  async function caught(promise) {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected a rejection');
  }

  it.each([
    ['another project\'s file', MEMBER, {_id: 'File2', meta: {type: 'cyclonedx'}}],
    ['another project\'s file on the internal call without a session', null, {_id: 'File2', meta: {type: 'cyclonedx'}}],
    ['a file that does not exist', MEMBER, {_id: 'Missing', meta: {type: 'cyclonedx'}}],
    ['a non-string file id', MEMBER, {_id: {$ne: null}, meta: {type: 'cyclonedx'}}],
    ['no file at all', MEMBER, undefined]
  ])('refuses %s with 403 before touching the import', async (label, caller, fileObj) => {
    const world = load({caller, files: FILES});
    const error = await caught(world.importModule({projectId: 'Project1', userId: MEMBER._id, fileObj}));
    expect(error.error).toBe(403);
    expect(world.collection.updateAsync).not.toHaveBeenCalled();
    expect(world.readImportFileContent).not.toHaveBeenCalled();
  });

  it('still refuses a caller who does not own the named project', async () => {
    const world = load({caller: MEMBER, files: FILES});
    const error = await caught(world.importModule({projectId: 'ProjectOfAnotherCompany', userId: MEMBER._id,
      fileObj: {_id: 'File2', meta: {type: 'cyclonedx'}}}));
    expect(error.error).toBe(403);
    expect(world.readImportFileContent).not.toHaveBeenCalled();
  });

  it('starts the import of a file uploaded for the named project', async () => {
    const world = load({caller: MEMBER, files: FILES});
    await world.importModule({projectId: 'Project1', userId: MEMBER._id, fileObj: {_id: 'File1', meta: {type: 'cyclonedx'}}});
    expect(world.collection.updateAsync.mock.calls[0][0]).toBe('File1');
    expect(world.collection.updateAsync.mock.calls[0][1].$set['meta.status']).toBe('STARTED');
    expect(world.readImportFileContent).toHaveBeenCalledWith(OWN_FILE);
  });
});

describe('ModuleImports documents are not client-writable', () => {
  function loadRules() {
    const rules = {allow: [], deny: []};
    loadMeteorModule('imports/server/collections/moduleImports.js', {
      'meteor/meteor': {Meteor: {publish: () => {}}},
      '/imports/lib/collections/moduleImports': {
        allow: (r) => rules.allow.push(r),
        deny: (r) => rules.deny.push(r)
      },
      '/imports/lib/collections/projects': {}
    }, {allowNoExports: true});
    return rules;
  }

  it('registers no allow rule', () => {
    expect(loadRules().allow).toHaveLength(0);
  });

  it.each(['insert', 'update', 'remove'])('denies a client %s even of the uploader\'s own document', (op) => {
    const rules = loadRules();
    const doc = {_id: 'File1', userId: MEMBER._id, meta: {projectId: 'Project1'}, versions: {original: {path: '/etc/hosts'}}};
    expect(rules.deny.some((rule) => typeof rule[op] === 'function' && rule[op](MEMBER._id, doc) === true)).toBe(true);
  });
});

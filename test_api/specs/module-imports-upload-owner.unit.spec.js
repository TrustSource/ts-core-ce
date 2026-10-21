/* eslint-disable no-undef */
// An import file is uploaded with client-supplied metadata: `meta.projectId` decides which
// project's Imports tab lists the file and who may download it, and `meta.userId` names the
// uploader. The upload hook used to check only size and extension, so a logged-in user could
// file an upload under another company's project, or under another user's name. The server
// now accepts an upload only for a project of the uploader's own company, recorded as the
// uploader's own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const COMPANY = 'CompanyAAAAAAAAAA';
const OTHER = 'CompanyBBBBBBBBBB';
const MEMBER = {_id: 'member1', profile: {companyId: COMPANY}};
const PROJECTS = {
  Own1: {_id: 'Own1', companyId: COMPANY},
  Foreign1: {_id: 'Foreign1', companyId: OTHER}
};

function loadHook(isServer) {
  let config = null;
  class FilesCollection {
    constructor(options) {
      config = options;
    }
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-imports-owner-'));
  loadMeteorModule('imports/lib/collections/moduleImports.js', {
    'meteor/meteor': {Meteor: {isServer}},
    'meteor/ostrio:files': {FilesCollection},
    '/imports/config': {Config: {METEOR_UPLOAD_FOLDER: root}},
    '/imports/lib/collections/projects': {findOneAsync: async (id) => PROJECTS[id]},
    '/imports/lib/files/downloadHeaders': {attachmentResponseHeaders: () => ({})}
  }, {globals: {require}});
  fs.rmSync(root, {recursive: true, force: true});
  return config.onBeforeUpload;
}

const uploader = (user) => ({userId: user ? user._id : null, userAsync: async () => user});
const file = (meta) => ({size: 1024, extension: 'json', meta});

describe('ModuleImports upload hook (server)', () => {
  const onBeforeUpload = loadHook(true);

  it('accepts an upload for a project of the uploader\'s company', async () => {
    await expect(onBeforeUpload.call(uploader(MEMBER), file({projectId: 'Own1', userId: MEMBER._id})))
      .resolves.toBe(true);
  });

  it('refuses an upload filed under another company\'s project', async () => {
    const result = await onBeforeUpload.call(uploader(MEMBER), file({projectId: 'Foreign1', userId: MEMBER._id}));
    expect(result).not.toBe(true);
  });

  it('refuses an unknown, missing or non-string project', async () => {
    for (const projectId of ['Nope', undefined, '', {$ne: null}, ['Own1']]) {
      const result = await onBeforeUpload.call(uploader(MEMBER), file({projectId, userId: MEMBER._id}));
      expect(result).not.toBe(true);
    }
  });

  it('refuses an upload recorded under another user\'s name', async () => {
    const result = await onBeforeUpload.call(uploader(MEMBER), file({projectId: 'Own1', userId: 'someoneElse'}));
    expect(result).not.toBe(true);
  });

  it('refuses a user without a company', async () => {
    const result = await onBeforeUpload.call(uploader({_id: 'loner', profile: {}}),
      file({projectId: 'Own1', userId: 'loner'}));
    expect(result).not.toBe(true);
  });

  it('still refuses a logged-out upload and a wrong file type', async () => {
    expect(await onBeforeUpload.call(uploader(null), file({projectId: 'Own1'}))).not.toBe(true);
    const exe = {size: 1024, extension: 'exe', meta: {projectId: 'Own1', userId: MEMBER._id}};
    expect(await onBeforeUpload.call(uploader(MEMBER), exe)).not.toBe(true);
  });
});

describe('ModuleImports upload hook (client pre-check)', () => {
  const onBeforeUpload = loadHook(false);

  it('only checks login, size and type in the browser; the server decides ownership', async () => {
    await expect(onBeforeUpload.call(uploader(MEMBER), file({projectId: 'Foreign1', userId: MEMBER._id})))
      .resolves.toBe(true);
  });
});

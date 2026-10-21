/* eslint-disable no-undef */
// Notice files keep their licenses in a JSON file on the local volume (CE replaced
// S3). findOne must merge that file back into the document, and nothing in the notice
// flow may still reach for the S3 module.
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const COMPANY = 'CompanyAAAAAAAAAA';

describe('NoticeFiles.FindOne', () => {
  function load({doc, stored}) {
    const reads = [];
    const {default: findOne} = loadMeteorModule('imports/lib/interactors/noticeFiles/findOne.js', {
      'meteor/meteor': {Meteor: {userAsync: async () => ({_id: 'u1', profile: {companyId: COMPANY}})}},
      '/imports/lib/collections/noticeFiles': {findOneAsync: async () => doc},
      '/imports/server/storage/fileStorage': {
        readJson: async (ref) => {
          reads.push(ref);
          return stored;
        }
      },
      '/imports/server/storage/storagePaths': require('../../imports/server/storage/storagePaths')
    });
    return {findOne, reads};
  }

  it('reads the licenses from the caller\'s notice-files folder by the stored file name', async () => {
    const world = load({
      doc: {_id: 'n1', companyId: COMPANY, fileUrl: `${COMPANY}/notice-files/1726560000000.json`, writtenOffer: 'db'},
      stored: {licenses: [{key: 'MIT'}], unknownLicenseComponents: ['x'], writtenOffer: 'file'}
    });
    const result = await world.findOne('n1');
    expect(world.reads).toEqual([{companyId: COMPANY, folder: 'notice-files', name: '1726560000000.json'}]);
    expect(result.licenses).toEqual([{key: 'MIT'}]);
    expect(result.unknownLicenseComponents).toEqual(['x']);
    expect(result.writtenOffer).toBe('file');
  });

  it('keeps the document as it is when the file is missing', async () => {
    const world = load({
      doc: {_id: 'n1', companyId: COMPANY, fileUrl: `${COMPANY}/notice-files/1.json`, writtenOffer: 'db'},
      stored: null
    });
    const result = await world.findOne('n1');
    expect(result.licenses).toBeUndefined();
    expect(result.writtenOffer).toBe('db');
  });
});

describe('NoticeFiles.Update', () => {
  function load({stored, updateResult}) {
    const writes = [];
    const {default: update} = loadMeteorModule('imports/lib/interactors/noticeFiles/update.js', {
      'meteor/meteor': {
        Meteor: {
          userAsync: async () => ({_id: 'u1', profile: {companyId: COMPANY, name: 'Test User'}}),
          Error: Error
        }
      },
      'meteor/alanning:roles': {
        Roles: {
          userIsInRole: async () => true
        }
      },
      '/imports/lib/collections/noticeFiles': {
        findOneAsync: async () => ({_id: 'n1', fileUrl: `${COMPANY}/notice-files/1726560000000.json`, created: new Date(1726560000000)}),
        updateAsync: async () => updateResult
      },
      '../componentModifications/createChangesList': () => {},
      '/imports/server/storage/fileStorage': {
        readJson: async () => stored,
        putFile: async (args) => {
          writes.push(args);
        }
      },
      '/imports/server/storage/storagePaths': require('../../imports/server/storage/storagePaths'),
      '/imports/lib/security/sanitizeModifier': {sanitizeModifier: (m) => m},
      '/imports/lib/security/sanitizeQuery': {stripDangerousOperators: (q) => q},
      // The approval's figures (#60) are covered by approvalStats.spec.js.
      '/imports/server/approvalStats': {writeApprovalStats: async () => {}}
    });
    return {update, writes};
  }

  it('fullData path: licenses come from fullData, stored unknownLicenseComponents and writtenOffer survive', async () => {
    const world = load({
      stored: {licenses: [{key: 'Old'}], unknownLicenseComponents: [{key: 'NO-LICENSE'}], writtenOffer: 'from-file'},
      updateResult: 1
    });
    const modifier = {$set: {description: 'updated'}};
    const result = await world.update(modifier, 'n1', null, null, {licenses: [{key: 'MIT'}]});
    expect(result).toBe(1);
    expect(world.writes).toHaveLength(1);
    const written = JSON.parse(world.writes[0].data);
    expect(written.licenses).toEqual([{key: 'MIT'}]);
    expect(written.unknownLicenseComponents).toEqual([{key: 'NO-LICENSE'}]);
    expect(written.writtenOffer).toBe('from-file');
    expect(world.writes[0].companyId).toBe(COMPANY);
    expect(world.writes[0].folder).toBe('notice-files');
    expect(world.writes[0].name).toBe('1726560000000.json');
  });

  it('single-license patch: only the matching license is replaced, other stored fields survive', async () => {
    const world = load({
      stored: {licenses: [{key: 'MIT'}, {key: 'Apache-2.0'}], unknownLicenseComponents: [], writtenOffer: 'from-file'},
      updateResult: 1
    });
    const modifier = {$set: {'licenses.$': {key: 'MIT', updated: true}}};
    const result = await world.update(modifier, 'n1', null, null, null);
    expect(result).toBe(1);
    expect(world.writes).toHaveLength(1);
    const written = JSON.parse(world.writes[0].data);
    expect(written.licenses).toHaveLength(2);
    expect(written.licenses[0]).toEqual({key: 'MIT', updated: true});
    expect(written.licenses[1]).toEqual({key: 'Apache-2.0'});
    expect(written.unknownLicenseComponents).toEqual([]);
    expect(written.writtenOffer).toBe('from-file');
  });

  it('missing stored file: putFile is still called with correct ref, licenses undefined if no fullData', async () => {
    const world = load({
      stored: null,
      updateResult: 1
    });
    const modifier = {$set: {description: 'updated'}};
    const result = await world.update(modifier, 'n1', null, null, null);
    expect(result).toBe(1);
    expect(world.writes).toHaveLength(1);
    const written = JSON.parse(world.writes[0].data);
    expect(written.licenses).toBeUndefined();
    expect(world.writes[0].companyId).toBe(COMPANY);
    expect(world.writes[0].folder).toBe('notice-files');
    expect(world.writes[0].name).toBe('1726560000000.json');
  });

  it('missing stored file with fullData: fullData licenses are used', async () => {
    const world = load({
      stored: null,
      updateResult: 1
    });
    const modifier = {$set: {description: 'updated'}};
    const result = await world.update(modifier, 'n1', null, null, {licenses: [{key: 'GPL-2.0'}]});
    expect(result).toBe(1);
    expect(world.writes).toHaveLength(1);
    const written = JSON.parse(world.writes[0].data);
    expect(written.licenses).toEqual([{key: 'GPL-2.0'}]);
  });
});

describe('notice file flow wiring', () => {
  it.each([
    'imports/lib/interactors/noticeFiles/create.js',
    'imports/lib/interactors/noticeFiles/findOne.js',
    'imports/lib/interactors/noticeFiles/update.js',
    'imports/server/collections/companies.js'
  ])('%s uses fileStorage, not the S3 module', (file) => {
    const source = readSourceWithoutComments(file);
    expect(source).not.toMatch(/ts-s3|tsS3/);
    expect(source).toMatch(/from '\/imports\/server\/storage\/fileStorage'/);
  });
});

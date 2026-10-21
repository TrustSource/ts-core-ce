/* eslint-disable no-undef */
// `publicBoMKey.getFile` / `publicNoticeKey.getFile` (companies.js) hold the same
// tenant line as `publicVexKey.getFile` (public-vex-key-getfile.unit.spec.js):
//
//   * a signed-in caller (the release keys page preview, reaching getFile as a
//     nested call) only ever gets a file of its OWN company's release; another
//     company's release, or a caller with no company, is the method's usual
//     not-found answer, with nothing looked up, signed or stored
//   * the public REST route runs with no user and is served from the key record
//
// The REAL companies.js is executed: its imports are swapped for the stubs below
// and the registered Meteor methods are captured.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const COMPANIES_JS = 'imports/server/collections/companies.js';
const OWN = 'company-own';
const OTHER = 'company-other';
const OWN_RELEASE = 'aprOwn0000000001';
const OTHER_RELEASE = 'aprOther00000001';
const ORPHAN_RELEASE = 'aprOrphan0000001';

class MeteorError extends Error {
  constructor(error, reason) {
    super(reason);
    this.error = error;
    this.reason = reason;
  }
}

function setup() {
  const methods = {};
  const calls = [];
  const state = {user: null};
  const approves = [
    {_id: OWN_RELEASE, companyId: OWN},
    {_id: OTHER_RELEASE, companyId: OTHER}
  ];
  // ORPHAN_RELEASE has files but no release record.
  const sboms = [
    {approveId: OWN_RELEASE, companyId: OWN, data: {project: {name: 'own'}, list: [{name: 'c1'}]}},
    {approveId: OTHER_RELEASE, companyId: OTHER, data: {project: {name: 'other'}, list: [{name: 'c2'}]}},
    {approveId: ORPHAN_RELEASE, companyId: OWN, data: {project: {name: 'orphan'}, list: [{name: 'c3'}]}}
  ];
  const notices = [
    {approveId: OWN_RELEASE, companyId: OWN, licenses: [{key: 'MIT'}]},
    {approveId: OTHER_RELEASE, companyId: OTHER, licenses: [{key: 'GPL-3.0'}]},
    {approveId: ORPHAN_RELEASE, companyId: OWN, licenses: [{key: 'BSD-3-Clause'}]}
  ];
  const lookups = {approves: [], sboms: [], sbomFiles: [], notices: []};
  const signed = [];

  const Meteor = {
    Error: MeteorError,
    methods: (defs) => Object.assign(methods, defs),
    publish: () => {},
    startup: () => {},
    userAsync: async () => state.user,
    callAsync: async (name, ...args) => {
      calls.push({name, args});
      if (methods[name]) return methods[name].apply({}, args);
      return undefined;
    }
  };
  const byApproveId = (rows, log) => ({
    deny: () => {},
    findOneAsync: async (selector) => {
      log.push(selector);
      return rows.find((r) => r.approveId === selector.approveId);
    }
  });
  const Approves = {
    findOneAsync: async (selector) => {
      lookups.approves.push(selector);
      return approves.find((a) => a._id === selector);
    }
  };
  const collection = () => ({deny: () => {}, findOneAsync: async () => null});

  loadMeteorModule(COMPANIES_JS, {
    'meteor/meteor': {Meteor},
    'meteor/alanning:roles': {Roles: {userIsInRole: async () => true}},
    '/imports/server/ServerUtils': {},
    '/imports/lib/userExtUtils': {},
    '/imports/lib/collections/companies': collection(),
    '/imports/lib/collections/projects': collection(),
    '/imports/lib/collections/modules': collection(),
    '/imports/lib/collections/noticeFiles': byApproveId(notices, lookups.notices),
    '/imports/lib/collections/approves': Approves,
    '/imports/lib/collections/approvalReports': collection(),
    '/imports/lib/collections/moduleAnalysis': collection(),
    '/imports/lib/collections/sboms': byApproveId(sboms, lookups.sboms),
    '/imports/lib/collections/sbomFiles': byApproveId([], lookups.sbomFiles),
    'uuid': {},
    'meteor/momentjs:moment': {moment: () => ({})},
    'underscore': require('underscore'),
    '/imports/lib/converter/vex': {default: {}, PUBLIC_VEX_CONFIDENCE: 3},
    '/imports/lib/models/signature': {
      get: async (file) => {
        signed.push(file);
        return 'signature';
      }
    },
    'country-list': {},
    '/imports/server/storage/fileStorage': {readJson: async () => null},
    '/imports/server/storage/storagePaths': {NOTICE_FILES_FOLDER: 'notice'},
    '/imports/server/security/companySecretFields': {COMPANY_SECRET_EXCLUDE: {}},
    '/imports/lib/crypto': {},
    '/imports/server/security/apiKeyUpgrade': {},
    '/imports/server/csaf/productId': {encodeIdMap: () => ({})},
    '/imports/lib/interactors/projects/vulnerabilityLive': {approvalReportSelector: () => ({})},
    '/imports/lib/companies/publicKeyRequests': {requestLogModifier: () => ({})},
    '/imports/lib/company/settingsAccess': {PRIVATE_ALGORITHM_ROLES: []},
    '/imports/server/releaseKeys': {createReleaseKey: () => ({})},
    '/imports/server/security/publicKeys': {
      newPublicKeyEntry: () => ({}), presentedKeyHashes: () => [], withoutSecret: (e) => e,
      revealPublicKey: () => ''
    }
  }, {allowNoExports: true});

  const call = (name, ...args) => methods[name].apply({}, args);
  const stored = () => calls.filter((c) => c.name === 'Signatures.create');
  return {call, state, lookups, signed, stored};
}

const KINDS = [
  {
    method: 'publicBoMKey.getFile',
    notFound: {error: 'SBOM file not found'},
    fileLookups: (ctx) => ctx.lookups.sboms.length + ctx.lookups.sbomFiles.length,
    own: {name: 'own', components: [{name: 'c1'}], signatures: ['signature']},
    other: {name: 'other', components: [{name: 'c2'}], signatures: ['signature']}
  },
  {
    method: 'publicNoticeKey.getFile',
    notFound: {error: 'Notice file not found'},
    fileLookups: (ctx) => ctx.lookups.notices.length,
    own: {licenses: [{key: 'MIT'}], signatures: ['signature']},
    other: {licenses: [{key: 'GPL-3.0'}], signatures: ['signature']}
  }
];

describe.each(KINDS)('$method: tenant scoping', (kind) => {
  it('a signed-in caller gets nothing for another company\'s release', async () => {
    const ctx = setup();
    ctx.state.user = {_id: 'u1', profile: {companyId: OWN}};
    await expect(ctx.call(kind.method, {releaseId: OTHER_RELEASE})).resolves.toEqual(kind.notFound);
    expect(kind.fileLookups(ctx)).toBe(0);
    expect(ctx.signed).toHaveLength(0);
    expect(ctx.stored()).toHaveLength(0);
  });

  it('a signed-in caller without a company gets nothing', async () => {
    const ctx = setup();
    ctx.state.user = {_id: 'u1', profile: {}};
    await expect(ctx.call(kind.method, {releaseId: OWN_RELEASE})).resolves.toEqual(kind.notFound);
    expect(kind.fileLookups(ctx)).toBe(0);
    expect(ctx.signed).toHaveLength(0);
    expect(ctx.stored()).toHaveLength(0);
  });

  it('a signed-in caller gets nothing for a release that does not exist', async () => {
    const ctx = setup();
    ctx.state.user = {_id: 'u1', profile: {companyId: OWN}};
    await expect(ctx.call(kind.method, {releaseId: ORPHAN_RELEASE})).resolves.toEqual(kind.notFound);
    expect(ctx.signed).toHaveLength(0);
    expect(ctx.stored()).toHaveLength(0);
  });

  it('NON-VACUITY: the own company\'s release still produces a signed file', async () => {
    const ctx = setup();
    ctx.state.user = {_id: 'u1', profile: {companyId: OWN}};
    await expect(ctx.call(kind.method, {releaseId: OWN_RELEASE})).resolves.toEqual(kind.own);
    expect(ctx.stored()).toHaveLength(1);
  });

  it('the public REST route (no signed-in user) is served from the key record', async () => {
    const ctx = setup();
    await expect(ctx.call(kind.method, {releaseId: OTHER_RELEASE})).resolves.toEqual(kind.other);
    expect(ctx.stored()).toHaveLength(1);
    // No release lookup is added to the unauthenticated path.
    expect(ctx.lookups.approves).toHaveLength(0);
  });
});

/* eslint-disable no-undef */
// `publicVexKey.getFile` must hold the same line as its siblings
// `publicBoMKey.getFile` / `publicNoticeKey.getFile` (companies.js):
//
//   * the key record is validated before any field reaches a selector, so an
//     operator like {releaseId: {$ne: null}} is a 400, not an arbitrary release
//   * no release, an unknown release or a release without a vulnerability
//     report is a clean `{error: 'VEX file not found'}` - it used to assign
//     `file.signatures` on `false` and die with a TypeError (a 500)
//   * a signed-in caller only ever gets a VEX of its OWN company's release
//     (the method is internal-only, see security-guard.js; this is the
//     in-method floor under that gate)
//
// The REAL companies.js is executed: its imports are swapped for the stubs below
// and the registered Meteor methods are captured.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const COMPANIES_JS = 'imports/server/collections/companies.js';
const OWN = 'company-own';
const OTHER = 'company-other';
const OWN_RELEASE = 'aprOwn0000000001';
const OTHER_RELEASE = 'aprOther00000001';
const BARE_RELEASE = 'aprBare000000001';

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
    {_id: OTHER_RELEASE, companyId: OTHER},
    {_id: BARE_RELEASE, companyId: OWN}
  ];
  const reports = [
    {type: 'vulnerability', approveId: OWN_RELEASE, companyId: OWN, data: {modules: [{_id: 'm1'}]}},
    {type: 'vulnerability', approveId: OTHER_RELEASE, companyId: OTHER, data: {modules: [{_id: 'm2'}]}}
  ];
  const lookups = {approves: [], reports: []};
  const vexCalls = [];

  const Meteor = {
    Error: MeteorError,
    methods: (defs) => Object.assign(methods, defs),
    publish: () => {},
    startup: () => {},
    userAsync: async () => state.user,
    callAsync: async (name, ...args) => {
      calls.push({name, args});
      if (methods[name]) return methods[name].apply({}, args);
      if (name === 'getProjectVulnerabilityDifference') {
        const approve = args[0];
        return reports.find((r) => r.approveId === approve._id) || null;
      }
      return undefined;
    }
  };
  const Approves = {
    findOneAsync: async (selector) => {
      lookups.approves.push(selector);
      return approves.find((a) => a._id === selector);
    }
  };
  const ApprovalReports = {
    findOneAsync: async (selector) => {
      lookups.reports.push(selector);
      return reports.find((r) => r.approveId === selector.approveId
        && (r.companyId === selector.$or[0].companyId));
    }
  };
  const VEX = {
    default: {
      fromVulnerabilityReport: async (data) => {
        vexCalls.push(data);
        return {document: {title: 'vex'}, modules: data.modules.length};
      }
    },
    PUBLIC_VEX_CONFIDENCE: 3
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
    '/imports/lib/collections/noticeFiles': collection(),
    '/imports/lib/collections/approves': Approves,
    '/imports/lib/collections/approvalReports': ApprovalReports,
    '/imports/lib/collections/moduleAnalysis': collection(),
    '/imports/lib/collections/sboms': collection(),
    '/imports/lib/collections/sbomFiles': collection(),
    'uuid': {},
    'meteor/momentjs:moment': {moment: () => ({})},
    'underscore': require('underscore'),
    '/imports/lib/converter/vex': VEX,
    '/imports/lib/models/signature': {get: async () => 'signature'},
    'country-list': {},
    '/imports/server/storage/fileStorage': {readJson: async () => null},
    '/imports/server/storage/storagePaths': {NOTICE_FILES_FOLDER: 'notice'},
    '/imports/server/security/companySecretFields': {COMPANY_SECRET_EXCLUDE: {}},
    '/imports/lib/crypto': {},
    '/imports/server/security/apiKeyUpgrade': {},
    '/imports/server/csaf/productId': {encodeIdMap: () => ({})},
    '/imports/lib/interactors/projects/vulnerabilityLive': {
      approvalReportSelector: (approveId, companyId) => ({
        type: 'vulnerability', approveId, $or: [{companyId}, {companyId: {$exists: false}}]
      })
    },
    '/imports/lib/companies/publicKeyRequests': {requestLogModifier: () => ({})},
    '/imports/lib/company/settingsAccess': {PRIVATE_ALGORITHM_ROLES: []},
    '/imports/server/releaseKeys': {createReleaseKey: () => ({})},
    '/imports/server/security/publicKeys': {
      newPublicKeyEntry: () => ({}), presentedKeyHashes: () => [], withoutSecret: (e) => e,
      revealPublicKey: () => ''
    }
  }, {allowNoExports: true});

  const getFile = (...args) => methods['publicVexKey.getFile'].apply({}, args);
  const stored = () => calls.filter((c) => c.name === 'Signatures.create');
  return {getFile, state, lookups, vexCalls, calls, stored};
}

const NOT_FOUND = {error: 'VEX file not found'};

describe('publicVexKey.getFile: input validation (mirrors publicBoMKey/publicNoticeKey)', () => {
  it.each([
    ['null', null],
    ['a string', OWN_RELEASE],
    ['an array', [OWN_RELEASE]],
    ['an operator releaseId', {releaseId: {$ne: null}}],
    ['a numeric releaseId', {releaseId: 42}]
  ])('rejects %s with a 400 before any lookup', async (label, key) => {
    const ctx = setup();
    await expect(ctx.getFile(key, 'release')).rejects.toMatchObject({error: 400, reason: 'Invalid key'});
    expect(ctx.lookups.approves).toHaveLength(0);
    expect(ctx.lookups.reports).toHaveLength(0);
  });

  it('never runs an unbound lookup when the key names no release', async () => {
    const ctx = setup();
    await expect(ctx.getFile({}, 'release')).resolves.toEqual(NOT_FOUND);
    await expect(ctx.getFile({releaseId: ''}, 'changes')).resolves.toEqual(NOT_FOUND);
    expect(ctx.lookups.approves).toHaveLength(0);
  });
});

describe('publicVexKey.getFile: not found is a clean answer, not a TypeError', () => {
  it.each(['release', 'changes'])('unknown release (%s) -> not found', async (type) => {
    const ctx = setup();
    await expect(ctx.getFile({releaseId: 'aprMissing000001'}, type)).resolves.toEqual(NOT_FOUND);
    expect(ctx.calls.map((c) => c.name)).not.toContain('getProjectVulnerabilityDifference');
    expect(ctx.stored()).toHaveLength(0);
  });

  it.each(['release', 'changes'])('release without a report (%s) -> not found', async (type) => {
    const ctx = setup();
    await expect(ctx.getFile({releaseId: BARE_RELEASE}, type)).resolves.toEqual(NOT_FOUND);
    expect(ctx.vexCalls).toHaveLength(0);
    expect(ctx.stored()).toHaveLength(0);
  });
});

describe('publicVexKey.getFile: tenant scoping', () => {
  it.each(['release', 'changes'])(
    'a signed-in caller gets nothing for another company\'s release (%s)', async (type) => {
      const ctx = setup();
      ctx.state.user = {_id: 'u1', profile: {companyId: OWN}};
      await expect(ctx.getFile({releaseId: OTHER_RELEASE}, type)).resolves.toEqual(NOT_FOUND);
      expect(ctx.vexCalls).toHaveLength(0);
      expect(ctx.stored()).toHaveLength(0);
      expect(ctx.calls.map((c) => c.name)).not.toContain('getProjectVulnerabilityDifference');
    });

  it('a signed-in caller without a company gets nothing', async () => {
    const ctx = setup();
    ctx.state.user = {_id: 'u1', profile: {}};
    await expect(ctx.getFile({releaseId: OWN_RELEASE}, 'release')).resolves.toEqual(NOT_FOUND);
    expect(ctx.vexCalls).toHaveLength(0);
  });

  it.each(['release', 'changes'])(
    'NON-VACUITY: the own company\'s release still produces a signed VEX (%s)', async (type) => {
      const ctx = setup();
      ctx.state.user = {_id: 'u1', profile: {companyId: OWN}};
      const file = await ctx.getFile({releaseId: OWN_RELEASE}, type);
      expect(file).toEqual({document: {title: 'vex'}, modules: 1, signatures: ['signature']});
      expect(ctx.stored()).toHaveLength(1);
    });

  it('the public REST route (no signed-in user) is served from the key record', async () => {
    const ctx = setup();
    const file = await ctx.getFile({releaseId: OTHER_RELEASE}, 'release');
    expect(file.signatures).toEqual(['signature']);
    // The report lookup stays scoped by the release's own company.
    expect(ctx.lookups.reports[0].$or[0]).toEqual({companyId: OTHER});
  });
});

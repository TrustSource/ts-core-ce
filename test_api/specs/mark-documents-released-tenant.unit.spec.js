/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// Approves.MarkDocumentsAsReleased acts for the caller's own company.
//
// The interactor took its acting user from `user || apiUser`, two arguments a
// DDP client sets. A manager of company A could call it with B's approval id and
// `{profile: {companyId: 'B'}}`: the role check ran on A's session user, the
// company check compared B with B, and B's scans were marked released, B's
// release key published and B's release webhook fired with a forged closedBy.
//
// The real source runs (loadMeteorModule) with recording stubs; the acting user
// is resolved by the real resolveActingUser.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const MARK_JS = 'imports/lib/interactors/approves/markDocumentsAsReleased.js';
const ACTING_USER_JS = 'imports/server/security/actingUser.js';

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const MANAGER_A = {_id: 'managerA', profile: {companyId: 'companyA'}};
const FORGED_B = {_id: 'x', profile: {companyId: 'companyB'}};
const API_USER_A = {_id: 'api', profile: {companyId: 'companyA'}};

const APPROVALS = {
  approvalOfA: {_id: 'approvalOfA', companyId: 'companyA', projectId: 'pA', modules: [{scanId: 'scanA'}],
    project: () => ({name: 'Project A'})},
  approvalOfB: {_id: 'approvalOfB', companyId: 'companyB', projectId: 'pB', modules: [{scanId: 'scanB'}],
    project: () => ({name: 'Project B'})}
};

function load({sessionUser = MANAGER_A} = {}) {
  const writes = {scans: [], analyses: [], releaseKeys: [], webhooks: [], logs: []};
  const Meteor = {
    Error: FakeMeteorError,
    userAsync: jest.fn(async () => sessionUser),
    users: {findOneAsync: jest.fn(async (id) => (sessionUser && id === sessionUser._id ? sessionUser : null))},
    callAsync: jest.fn(async (name, ...args) => {
      writes.logs.push({name, args});
    })
  };
  const Roles = {
    // A is a manager of companyA only.
    userIsInRole: jest.fn(async (userId, roles, companyId) =>
      (userId === 'managerA' && companyId === 'companyA')),
    userIsInRoleAsync: jest.fn(async () => false)
  };
  const {resolveActingUser} = loadMeteorModule(ACTING_USER_JS, {'meteor/meteor': {Meteor}});
  const {default: markDocumentsAsReleased} = loadMeteorModule(MARK_JS, {
    'meteor/meteor': {Meteor},
    'meteor/alanning:roles': {Roles},
    '/imports/lib/collections/approves': {findOneAsync: async (id) => APPROVALS[id] || null},
    '/imports/lib/collections/scans': {updateAsync: async (id) => writes.scans.push(id)},
    '/imports/lib/collections/moduleAnalysis': {updateAsync: async (id) => writes.analyses.push(id)},
    '/imports/lib/utils': {username: (u) => u && u._id},
    '/imports/startup/server/ts-webhook': {tsWebhook: async (hook) => writes.webhooks.push(hook)},
    '/imports/server/releaseKeys': {
      ensureReleaseKey: async (companyId, releaseId) => {
        writes.releaseKeys.push({companyId, releaseId});
        return {releaseId};
      }
    },
    '/imports/server/security/actingUser': {resolveActingUser}
  });
  return {markDocumentsAsReleased, writes};
}

const clientCtx = {connection: {id: 'ddp-1'}, userId: 'managerA'};
const serverCtx = {connection: null, userId: null};

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function expectNoWrites(writes) {
  expect(writes.scans).toEqual([]);
  expect(writes.analyses).toEqual([]);
  expect(writes.releaseKeys).toEqual([]);
  expect(writes.webhooks).toEqual([]);
}

describe('Approves.MarkDocumentsAsReleased tenant isolation', () => {
  it('refuses a client that forges apiUser to target another company, without any write', async () => {
    const {markDocumentsAsReleased, writes} = load();
    const error = await caught(markDocumentsAsReleased.call(clientCtx, null, 'approvalOfB', FORGED_B));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('refuses a client that forges the user argument to target another company', async () => {
    const {markDocumentsAsReleased, writes} = load();
    const error = await caught(markDocumentsAsReleased.call(clientCtx, FORGED_B, 'approvalOfB'));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('acts as the session user on a client connection (the UI approve flow)', async () => {
    const {markDocumentsAsReleased, writes} = load();
    await expect(markDocumentsAsReleased.call(clientCtx, MANAGER_A, 'approvalOfA')).resolves.toBe(1);
    expect(writes.scans).toEqual(['scanA']);
    expect(writes.releaseKeys).toEqual([{companyId: 'companyA', releaseId: 'approvalOfA'}]);
    expect(writes.webhooks[0].companyId).toBe('companyA');
    expect(writes.webhooks[0].data.closedBy).toBe('managerA');
  });

  it('trusts the API user on a server call (the REST approvals route)', async () => {
    const {markDocumentsAsReleased, writes} = load({sessionUser: null});
    await expect(markDocumentsAsReleased.call(serverCtx, null, 'approvalOfA', API_USER_A)).resolves.toBe(1);
    expect(writes.releaseKeys).toEqual([{companyId: 'companyA', releaseId: 'approvalOfA'}]);
    expect(writes.webhooks[0].data.closedBy).toBe('api');
  });

  it('still refuses another company\'s approval on a server call', async () => {
    const {markDocumentsAsReleased, writes} = load({sessionUser: null});
    const error = await caught(markDocumentsAsReleased.call(serverCtx, null, 'approvalOfB', API_USER_A));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('refuses a server call with no user at all', async () => {
    const {markDocumentsAsReleased, writes} = load({sessionUser: null});
    const error = await caught(markDocumentsAsReleased.call(serverCtx, null, 'approvalOfA'));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });
});

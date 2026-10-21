/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// Approves.Approve / Approves.Reject require the approving role.
//
// Both interactors skipped the manager/compliance_manager check whenever an
// `apiUser` argument was present - `(!user || !role) && !apiUser` - and a DDP
// client sets that argument. A logged-in member without the role could pass
// `{}` and approve or reject their own company's approvals: the tenant check
// used the session user, so only the role check was bypassed.
//
// Approves.Update is checked here too: it already ignores apiUser for a
// logged-in client and runs the role check on the session user.
//
// The real sources run (loadMeteorModule) with recording stubs; the acting user
// is resolved by the real resolveActingUser.
// ---------------------------------------------------------------------------
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

const APPROVE_JS = 'imports/lib/interactors/approves/approve.js';
const REJECT_JS = 'imports/lib/interactors/approves/reject.js';
const UPDATE_JS = 'imports/lib/interactors/approves/update.js';
const ACTING_USER_JS = 'imports/server/security/actingUser.js';

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

const MANAGER_A = {_id: 'managerA', profile: {companyId: 'companyA'}};
const COMPLIANCE_A = {_id: 'complianceA', profile: {companyId: 'companyA'}};
const MEMBER_A = {_id: 'memberA', profile: {companyId: 'companyA'}};
const API_USER_A = {_id: 'api', profile: {companyId: 'companyA'}};
const USERS = {managerA: MANAGER_A, complianceA: COMPLIANCE_A, memberA: MEMBER_A};
const ROLE_HOLDERS = ['managerA', 'complianceA'];

const APPROVALS = {
  approvalOfA: {_id: 'approvalOfA', companyId: 'companyA', projectId: 'pA', project: () => ({name: 'Project A'})},
  approvalOfB: {_id: 'approvalOfB', companyId: 'companyB', projectId: 'pB', project: () => ({name: 'Project B'})}
};

function stubs({sessionUser, writes}) {
  const Meteor = {
    Error: FakeMeteorError,
    userAsync: jest.fn(async () => sessionUser),
    users: {findOneAsync: jest.fn(async (id) => USERS[id] || null)},
    callAsync: jest.fn(async (name, ...args) => {
      writes.calls.push({name, args});
    })
  };
  const Roles = {
    // managerA and complianceA hold an approving role in companyA only.
    userIsInRole: jest.fn(async (userId, roles, companyId) =>
      ROLE_HOLDERS.includes(userId) && companyId === 'companyA')
  };
  const {resolveActingUser} = loadMeteorModule(ACTING_USER_JS, {'meteor/meteor': {Meteor}});
  return {Meteor, Roles, resolveActingUser};
}

function load(rel, {sessionUser = MEMBER_A} = {}) {
  const writes = {updates: [], calls: [], webhooks: []};
  const {Meteor, Roles, resolveActingUser} = stubs({sessionUser, writes});
  const {default: interactor} = loadMeteorModule(rel, {
    'meteor/meteor': {Meteor},
    'meteor/alanning:roles': {Roles},
    '/imports/lib/utils': {username: (u) => u && u._id},
    '/imports/lib/collections/approves': {findOneAsync: async (id) => APPROVALS[id] || null},
    './update': async (modifier, _id, filter, apiUser) => {
      writes.updates.push({modifier, _id, apiUser});
      return 1;
    },
    '/imports/startup/server/ts-webhook': {tsWebhook: async (hook) => writes.webhooks.push(hook)},
    '/imports/server/security/actingUser': {resolveActingUser}
  });
  return {interactor, writes};
}

const clientCtx = (userId) => ({connection: {id: 'ddp-1'}, userId});
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
  expect(writes.updates).toEqual([]);
  expect(writes.calls).toEqual([]);
  expect(writes.webhooks).toEqual([]);
}

// approve(_id, apiUser) and reject(_id, reason, apiUser) differ only in the reason.
const CASES = [
  ['Approves.Approve', APPROVE_JS, (fn, ctx, id, apiUser) => fn.call(ctx, id, apiUser), 'approved'],
  ['Approves.Reject', REJECT_JS, (fn, ctx, id, apiUser) => fn.call(ctx, id, 'not ok', apiUser), 'rejected']
];

describe.each(CASES)('%s role check', (name, rel, invoke, stampField) => {
  it('refuses a logged-in member without the role who passes a forged empty apiUser', async () => {
    const {interactor, writes} = load(rel, {sessionUser: MEMBER_A});
    const error = await caught(invoke(interactor, clientCtx('memberA'), 'approvalOfA', {}));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('refuses a logged-in member who forges a role holder as apiUser', async () => {
    const {interactor, writes} = load(rel, {sessionUser: MEMBER_A});
    const error = await caught(invoke(interactor, clientCtx('memberA'), 'approvalOfA', MANAGER_A));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('refuses a logged-in member without any apiUser', async () => {
    const {interactor, writes} = load(rel, {sessionUser: MEMBER_A});
    const error = await caught(invoke(interactor, clientCtx('memberA'), 'approvalOfA'));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it.each([['manager', MANAGER_A], ['compliance_manager', COMPLIANCE_A]])(
    'lets a %s act through the UI as the session user', async (_role, sessionUser) => {
      const {interactor, writes} = load(rel, {sessionUser});
      await expect(invoke(interactor, clientCtx(sessionUser._id), 'approvalOfA')).resolves.toBe(1);
      expect(writes.updates).toHaveLength(1);
      expect(writes.updates[0]._id).toBe('approvalOfA');
      expect(writes.updates[0].modifier.$set.closedBy).toBe(sessionUser._id);
      expect(writes.updates[0].modifier.$set[stampField]).toBeInstanceOf(Date);
      expect(writes.webhooks[0].companyId).toBe('companyA');
      expect(writes.webhooks[0].data.closedBy).toBe(sessionUser._id);
      // The nested side effects get the session user, not an API user.
      const notify = writes.calls.find((c) => c.name === 'notifyAboutApprovedOrRejected');
      expect(notify.args).toEqual([sessionUser, 'approvalOfA', undefined]);
    });

  it('acts as the session manager, not a forged apiUser, on a client connection', async () => {
    const {interactor, writes} = load(rel, {sessionUser: MANAGER_A});
    const forged = {_id: 'x', profile: {companyId: 'companyA'}};
    await expect(invoke(interactor, clientCtx('managerA'), 'approvalOfA', forged)).resolves.toBe(1);
    expect(writes.updates[0].modifier.$set.closedBy).toBe('managerA');
    expect(writes.updates[0].apiUser).toBeUndefined();
    const notify = writes.calls.find((c) => c.name === 'notifyAboutApprovedOrRejected');
    expect(notify.args).toEqual([MANAGER_A, 'approvalOfA', undefined]);
  });

  it('refuses a manager on another company\'s approval through the UI', async () => {
    const {interactor, writes} = load(rel, {sessionUser: MANAGER_A});
    const error = await caught(invoke(interactor, clientCtx('managerA'), 'approvalOfB'));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('trusts the API user on a server call (the REST approvals route)', async () => {
    const {interactor, writes} = load(rel, {sessionUser: null});
    await expect(invoke(interactor, serverCtx, 'approvalOfA', API_USER_A)).resolves.toBe(1);
    expect(writes.updates[0].modifier.$set.closedBy).toBe('api');
    expect(writes.updates[0].apiUser).toBe(API_USER_A);
    expect(writes.webhooks[0].companyId).toBe('companyA');
    const notify = writes.calls.find((c) => c.name === 'notifyAboutApprovedOrRejected');
    expect(notify.args).toEqual([null, 'approvalOfA', API_USER_A]);
  });

  it('still refuses another company\'s approval on a server call', async () => {
    const {interactor, writes} = load(rel, {sessionUser: null});
    const error = await caught(invoke(interactor, serverCtx, 'approvalOfB', API_USER_A));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });

  it('refuses a server call with no user at all', async () => {
    const {interactor, writes} = load(rel, {sessionUser: null});
    const error = await caught(invoke(interactor, serverCtx, 'approvalOfA'));
    expect(error.error).toBe(403);
    expectNoWrites(writes);
  });
});

describe('Approves.Approve nested release step', () => {
  it('passes the resolved actor to Approves.MarkDocumentsAsReleased', async () => {
    const {interactor, writes} = load(APPROVE_JS, {sessionUser: MANAGER_A});
    await interactor.call(clientCtx('managerA'), 'approvalOfA', {});
    const release = writes.calls.find((c) => c.name === 'Approves.MarkDocumentsAsReleased');
    expect(release.args).toEqual([MANAGER_A, 'approvalOfA', undefined]);
  });

  it('passes the API user to Approves.MarkDocumentsAsReleased on a REST call', async () => {
    const {interactor, writes} = load(APPROVE_JS, {sessionUser: null});
    await interactor.call(serverCtx, 'approvalOfA', API_USER_A);
    const release = writes.calls.find((c) => c.name === 'Approves.MarkDocumentsAsReleased');
    expect(release.args).toEqual([null, 'approvalOfA', API_USER_A]);
  });
});

describe('Approves.Update role check', () => {
  function loadUpdate({sessionUser}) {
    const writes = {updates: [], calls: [], webhooks: []};
    const {Meteor, Roles} = stubs({sessionUser, writes});
    const {default: update} = loadMeteorModule(UPDATE_JS, {
      'meteor/meteor': {Meteor},
      'meteor/alanning:roles': {Roles},
      '/imports/lib/utils': {username: (u) => u && u._id},
      '/imports/lib/collections/approves': {
        updateAsync: async (query, modifier) => {
          writes.updates.push({query, modifier});
          return 1;
        }
      },
      '/imports/lib/security/sanitizeModifier': {sanitizeModifier: (m) => m},
      '/imports/lib/security/sanitizeQuery': {stripDangerousOperators: (q) => q}
    });
    return {update, writes};
  }

  it('refuses a logged-in member without the role who passes a forged apiUser', async () => {
    const {update, writes} = loadUpdate({sessionUser: MEMBER_A});
    const forged = {_id: 'x', profile: {companyId: 'companyB'}};
    const error = await caught(update.call(clientCtx('memberA'), {$set: {name: 'n'}}, 'approvalOfA', null, forged));
    expect(error.error).toBe(403);
    expect(writes.updates).toEqual([]);
  });

  it('scopes a logged-in manager to the session company even with a forged apiUser', async () => {
    const {update, writes} = loadUpdate({sessionUser: MANAGER_A});
    const forged = {_id: 'x', profile: {companyId: 'companyB'}};
    await update.call(clientCtx('managerA'), {$set: {name: 'n'}}, 'approvalOfA', null, forged);
    expect(writes.updates[0].query).toEqual({_id: 'approvalOfA', companyId: 'companyA'});
    expect(writes.updates[0].modifier.$set.userId).toBe('managerA');
  });

  it('uses the API user on a server call with no session (REST and detached generation)', async () => {
    const {update, writes} = loadUpdate({sessionUser: null});
    await update.call(serverCtx, {$set: {name: 'n'}}, 'approvalOfA', null, API_USER_A);
    expect(writes.updates[0].query).toEqual({_id: 'approvalOfA', companyId: 'companyA'});
  });

  it('refuses a call with neither a session nor an API user', async () => {
    const {update, writes} = loadUpdate({sessionUser: null});
    const error = await caught(update.call(serverCtx, {$set: {name: 'n'}}, 'approvalOfA', null));
    expect(error.error).toBe(403);
    expect(writes.updates).toEqual([]);
  });
});

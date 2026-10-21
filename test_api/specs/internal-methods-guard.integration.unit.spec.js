/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// Server-only methods in the central DDP guard, as an actual method call.
//
// ComponentLogs.Create writes the platform-wide component history with whatever
// author the caller names, then trims that component to its newest 10 entries.
// It has no client caller: scan processing and other server code call
// it from server code. Any logged-in client could still call it directly (and
// insert into the collection past an allow rule that returned true), forging
// entries or pushing a component's real history out with ten calls.
//
// A plain `this.connection` check inside the method cannot tell the two apart:
// a server call nested inside a client-initiated method (reprocessScan ->
// processScan -> addLog) inherits the client's connection. The guard already
// knows the difference - its `pastGate` is set for nested calls - so the
// server-only list lives there. This spec lifts the shipped guard source (same
// technique as csaf-product-id-methods.integration.unit.spec.js) and observes
// the outcome of each kind of call.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const SECURITY_GUARD_JS = 'imports/startup/server/security-guard.js';
const ACCOUNT_STATUS_JS = 'imports/lib/accountStatus.js';
const COMPONENT_LOGS_JS = 'imports/server/collections/componentLogs.js';

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// Drop every top-level `import ...;` statement and the ESM export keyword, so the
// remainder can run inside a `new Function` with the former imports supplied.
function toRunnable(source) {
  return source
    .replace(/^import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '')
    .replace(/^import\s+'[^']*';[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '');
}

const accountStatus = new Function(
  `${readRepo(ACCOUNT_STATUS_JS).replace(/^export /gm, '')}
   return {ACCOUNT_STATUS, ACCOUNT_STATUS_FIELD, accountStatusOf};`)();

// Everything above the Meteor.startup installer; the installer's wrapping is
// replicated in buildWorld() below.
const SECURITY_GUARD_SRC = (function () {
  const source = toRunnable(readRepo(SECURITY_GUARD_JS));
  const cut = source.indexOf('Meteor.startup(');
  if (cut === -1) {
    throw new Error('security-guard.js no longer installs its guard in Meteor.startup; re-anchor');
  }
  return source.slice(0, cut);
})();
const loadSecurityGuard = new Function(
  'Meteor', 'accountStatusOf', 'ACCOUNT_STATUS', 'ACCOUNT_STATUS_FIELD',
  `${SECURITY_GUARD_SRC}
   return {
     guardMethodHandler,
     _clearAccountActiveCache,
     INTERNAL_METHODS: typeof INTERNAL_METHODS === 'undefined' ? new Set() : INTERNAL_METHODS
   };`);

class FakeMeteorError extends Error {
  constructor(error, reason) {
    super(`[${error}] ${reason}`);
    this.error = error;
    this.reason = reason;
  }
}

// Meteor 3's EnvironmentVariable lives in AsyncLocalStorage, so pastGate stays
// set across an `await` inside the gated method (Approves.Approve awaits one
// side effect before calling the next).
const {AsyncLocalStorage} = require('async_hooks');

class FakeEnvironmentVariable {
  constructor() {
    this.storage = new AsyncLocalStorage();
  }

  get() {
    const store = this.storage.getStore();
    return store && store.value;
  }

  withValue(value, fn) {
    return this.storage.run({value}, fn);
  }
}

function buildWorld() {
  const userId = 'userAAAAAAAAAAAAA';
  const userDoc = {_id: userId, profile: {companyId: 'companyA'}};
  const Meteor = {
    Error: FakeMeteorError,
    EnvironmentVariable: FakeEnvironmentVariable,
    users: {
      async findOneAsync() {
        return userDoc;
      }
    }
  };
  const {guardMethodHandler, _clearAccountActiveCache, INTERNAL_METHODS} = loadSecurityGuard(
    Meteor, accountStatus.accountStatusOf, accountStatus.ACCOUNT_STATUS, accountStatus.ACCOUNT_STATUS_FIELD);
  _clearAccountActiveCache();

  const calls = {log: 0, other: 0};
  const guarded = {};
  guarded['ComponentLogs.Create'] = guardMethodHandler('ComponentLogs.Create', async () => {
    calls.log += 1;
    return 'logged';
  });
  guarded['Other.Method'] = guardMethodHandler('Other.Method', async () => {
    calls.other += 1;
    return 'other';
  });
  // A client-callable method that, like reprocessScan, calls the server-only one
  // from server code. The nested call inherits the client connection.
  guarded.reprocessScan = guardMethodHandler('reprocessScan', function () {
    return guarded['ComponentLogs.Create'].apply(this, [{text: 'mapped license'}]);
  });
  // The approval's side effects: only Approves.Approve / Approves.Reject (UI) and
  // the REST approvals route (through Approves.Approve) call them.
  calls.released = 0;
  calls.notified = 0;
  guarded['Approves.MarkDocumentsAsReleased'] = guardMethodHandler('Approves.MarkDocumentsAsReleased', async () => {
    calls.released += 1;
    return 1;
  });
  guarded.notifyAboutApprovedOrRejected = guardMethodHandler('notifyAboutApprovedOrRejected', async () => {
    calls.notified += 1;
  });
  guarded['Approves.Approve'] = guardMethodHandler('Approves.Approve', async function (_id, apiUser) {
    await guarded.notifyAboutApprovedOrRejected.apply(this, [null, _id, apiUser]);
    return guarded['Approves.MarkDocumentsAsReleased'].apply(this, [null, _id, apiUser]);
  });

  const client = {connection: {id: 'ddp-1'}, userId};
  return {
    calls,
    INTERNAL_METHODS,
    asUser: (name, ...args) => guarded[name].apply(client, args),
    anonymous: (name, ...args) => guarded[name].apply({connection: {id: 'ddp-2'}, userId: null}, args),
    internal: (name, ...args) => guarded[name].apply({connection: null, userId: null}, args)
  };
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('INTERNAL_METHODS (server-only methods in the DDP guard)', () => {
  it('lists the server-only methods', () => {
    expect([...buildWorld().INTERNAL_METHODS]).toEqual([
      'ComponentLogs.Create',
      'publicBoMKey.one',
      'publicBoMKey.getFile',
      'publicBoMKey.saveRequest',
      'publicNoticeKey.one',
      'publicNoticeKey.getFile',
      'publicNoticeKey.saveRequest',
      'publicReleaseKey.one',
      'publicReleaseKey.saveRequest',
      'publicVexKey.getFile',
      'publicCsafKey.findByKey',
      'publicCsafKey.saveRequest',
      'Signatures.create',
      'Signatures.count',
      'Signatures.findOne',
      'Approves.MarkDocumentsAsReleased',
      'notifyAboutApprovedOrRejected'
    ]);
  });

  it('refuses a logged-in client calling ComponentLogs.Create directly, without running it', async () => {
    const world = buildWorld();
    const error = await caught(world.asUser('ComponentLogs.Create', {createdBy: 'forged@example.test'}));
    expect(error.error).toBe(403);
    expect(world.calls.log).toBe(0);
  });

  it('refuses an anonymous client too, without running it', async () => {
    const world = buildWorld();
    const error = await caught(world.anonymous('ComponentLogs.Create', {}));
    expect([401, 403]).toContain(error.error);
    expect(world.calls.log).toBe(0);
  });

  it('runs it for server code (REST routes, interactors)', async () => {
    const world = buildWorld();
    await expect(world.internal('ComponentLogs.Create', {})).resolves.toBe('logged');
    expect(world.calls.log).toBe(1);
  });

  it('runs it nested inside a method a client did call, which inherits the connection', async () => {
    const world = buildWorld();
    await expect(world.asUser('reprocessScan')).resolves.toBe('logged');
    expect(world.calls.log).toBe(1);
  });

  it('leaves other authenticated client methods alone', async () => {
    const world = buildWorld();
    await expect(world.asUser('Other.Method')).resolves.toBe('other');
    expect(world.calls.other).toBe(1);
  });
});

// Approves.MarkDocumentsAsReleased took the company from a user object in its
// arguments, so a client could name another company and publish that company's
// release key, mark its scans released and fire its release webhook. Both
// approval side effects are server-only.
describe('INTERNAL_METHODS: the approval side effects', () => {
  const forged = {_id: 'x', profile: {companyId: 'companyB'}};

  it.each(['Approves.MarkDocumentsAsReleased', 'notifyAboutApprovedOrRejected'])(
    'refuses a logged-in client calling %s directly, without running it', async (name) => {
      const world = buildWorld();
      const error = await caught(world.asUser(name, null, 'approvalOfB', forged));
      expect(error.error).toBe(403);
      expect(world.calls.released).toBe(0);
      expect(world.calls.notified).toBe(0);
    });

  it('runs them nested inside Approves.Approve from the UI', async () => {
    const world = buildWorld();
    await expect(world.asUser('Approves.Approve', 'approvalOfA')).resolves.toBe(1);
    expect(world.calls.released).toBe(1);
    expect(world.calls.notified).toBe(1);
  });

  it('runs them for the REST approvals route (no connection)', async () => {
    const world = buildWorld();
    await expect(world.internal('Approves.Approve', 'approvalOfA', {_id: 'api', profile: {companyId: 'companyA'}}))
      .resolves.toBe(1);
    expect(world.calls.released).toBe(1);
    expect(world.calls.notified).toBe(1);
  });
});

describe('componentLogs collection rules', () => {
  // Comment-blind assertions would happily pass on a commented-out rule.
  const source = readRepo(COMPONENT_LOGS_JS)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');

  it('never lets a client insert directly', () => {
    const allow = source.match(/ComponentLogs\.allow\(\{([\s\S]*?)\n\}\);/);
    expect(allow).not.toBeNull();
    const insert = allow[1].match(/insert\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
    expect(insert).not.toBeNull();
    expect(insert[1].trim()).toMatch(/^return\s+false;?$/);
  });
});

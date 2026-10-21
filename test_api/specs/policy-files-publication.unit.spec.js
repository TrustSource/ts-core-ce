/* eslint-disable no-undef */
// The `policyFiles` publication was a one-shot join: it fetched the company's policies once,
// froze the referenced file ids, and published `find({_id: {$in: frozenIds}})`. The subscription
// starts at app boot, so for a fresh company the frozen set was empty and no policy file ever
// arrived - the list rendered "No file" and the Knowledge page dropped its download link until
// a full reload. It is now a live join built on two levels of `observeChangesAsync`.
//
// Running that lifecycle needs a Meteor server with a real Mongo oplog/poll driver and a DDP
// client to observe added/changed/removed messages. This repo's CI runs Jest only, and the
// `meteor test --driver-package meteortesting:mocha` harness is currently broken (it dies in
// Meteor's own bundled packages/modules.js before app code loads) - see the report's Coverage
// Gaps for what a real harness would need.
//
// What IS worth guarding without that harness are the structural invariants of a hand-written
// observe join, because getting them wrong leaks server resources or corrupts a client's
// collection rather than producing a visible test failure:
//   * every observe handle acquired must be stopped on unsubscribe;
//   * `removed` must only be sent for documents that were actually `added`;
//   * a policy switching files must retain the new id BEFORE releasing the old one;
//   * the tenant predicate must be unchanged.
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const src = readSourceWithoutComments('imports/server/collections/policyFiles.js');

describe('policyFiles publication - authorization is unchanged', () => {
  it('refuses an anonymous subscription', () => {
    expect(src).toMatch(/if \(!self\.userId\) \{ return self\.ready\(\); \}/);
  });

  it('resolves the company server-side and bails when there is none', () => {
    expect(src).toMatch(/Utils\.getCompanyIdForUserAsync\(self\.userId\)/);
    expect(src).toMatch(/if \(!companyId\) \{ return self\.ready\(\); \}/);
  });

  it('observes only the caller company’s policies', () => {
    expect(src).toMatch(/Policy\.find\(\{companyId\}/);
  });

  it('never publishes the whole policyFiles collection', () => {
    // The join must stay id-scoped; an unscoped cursor would hand every tenant’s files out.
    expect(src).not.toMatch(/policyFiles\.collection\.find\(\)/);
    expect(src).toMatch(/policyFiles\.collection\.find\(\{_id: fileId\}\)/);
  });
});

describe('policyFiles publication - no leaked observe handles', () => {
  // Sliced to end-of-file: `self.ready()` also appears in the early-return guards above, so
  // an end anchor there would silently produce an empty slice.
  const onStopAt = src.indexOf('self.onStop(');
  const onStop = onStopAt === -1 ? '' : src.slice(onStopAt);

  it('registers an onStop that stops the policy observer', () => {
    expect(onStopAt).toBeGreaterThan(-1);
    expect(onStop).toMatch(/policyHandle\.stop\(\)/);
  });

  it('onStop also stops every per-file observer, not just the policy one', () => {
    expect(onStop).toMatch(/fileHandles\.forEach\(function \(handle\) \{ handle\.stop\(\); \}\)/);
    expect(onStop).toMatch(/fileHandles\.clear\(\)/);
  });

  it('sets a stopped flag so an in-flight retain does not resurrect an observer', () => {
    // retainFile awaits observeChangesAsync; the subscription can stop during that await.
    expect(src).toMatch(/stopped = true/);
    const retain = src.slice(src.indexOf('async function retainFile'), src.indexOf('function releaseFile'));
    expect(retain).not.toBe('');
    // Checked before the observer is created...
    expect(retain.slice(0, retain.indexOf('observeChangesAsync'))).toMatch(/\bstopped\b\)?\s*return;/);
    // ...and again after the await, discarding a handle the stop already missed.
    expect(retain).toMatch(/if \(stopped\) \{\s*handle\.stop\(\);\s*return;\s*\}/);
  });

  it('releases the handle when the last referencing policy goes away', () => {
    const release = src.slice(src.indexOf('function releaseFile'));
    expect(release).toMatch(/handle\.stop\(\)/);
    expect(release).toMatch(/fileHandles\.delete\(fileId\)/);
  });

  it('reference-counts, so two policies sharing a file keep one observer', () => {
    const retain = src.slice(src.indexOf('async function retainFile'), src.indexOf('function releaseFile'));
    expect(retain).toMatch(/if \(next > 1\) return;/);
    const release = src.slice(src.indexOf('function releaseFile'));
    expect(release).toMatch(/if \(next > 0\) \{[\s\S]*?return;/);
  });
});

describe('policyFiles publication - DDP messages stay consistent', () => {
  it('only retracts a document it actually sent', () => {
    // `self.removed` for an id the client never received throws on the DDP session.
    const release = src.slice(src.indexOf('function releaseFile'));
    expect(release).toMatch(/if \(addedFiles\.delete\(fileId\)\) \{\s*self\.removed\(/);
  });

  it('records what it sent, and unrecords it when the source document disappears', () => {
    // Both directions: added -> tracked, removed -> untracked, or the set drifts.
    const observe = src.slice(src.indexOf('observeChangesAsync({'));
    expect(observe).toMatch(/added: function \(id, fields\) \{\s*addedFiles\.add\(id\);/);
    expect(observe).toMatch(/removed: function \(id\) \{\s*addedFiles\.delete\(id\);/);
  });

  const changedAt = src.indexOf('changed: function (policyId, fields)');
  const changedCb = changedAt === -1 ? '' : src.slice(changedAt, changedAt + 600);

  it('retains the new file BEFORE releasing the old one when a policy is repointed', () => {
    expect(changedAt).toBeGreaterThan(-1);
    const retainAt = changedCb.indexOf('retainFile(');
    const releaseAt = changedCb.indexOf('releaseFile(');
    expect(retainAt).toBeGreaterThan(-1);
    expect(releaseAt).toBeGreaterThan(retainAt);  // otherwise a shared file is briefly dropped
    expect(changedCb.slice(retainAt - 10, retainAt)).toMatch(/await\s*$/);
  });

  it('ignores a policy change that did not touch the file reference', () => {
    expect(changedCb).toMatch(/hasOwnProperty\.call\(fields, 'file'\)/);
    // Short-circuits when the (normalised) reference is unchanged.
    expect(changedCb).toMatch(/if \(previous === \w+\) return;/);
  });

  it('serialises the async retain/release work through one queue', () => {
    // Observe callbacks are synchronous; retain/release are not. Without the queue a
    // repoint could release the old id before the new one was retained.
    expect(src).toMatch(/queue = queue\.then\(task\)\.catch\(/);
    ['added', 'changed', 'removed'].forEach((cb) => {
      const at = src.indexOf(`${cb}: function (policyId`);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(at, at + 400)).toMatch(/enqueue\(/);
    });
  });

  it('signals ready only after the initial join has drained', () => {
    const readyAt = src.lastIndexOf('self.ready()');
    const awaitQueueAt = src.lastIndexOf('await queue');
    expect(awaitQueueAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(awaitQueueAt);
  });

  it('no longer returns a frozen $in cursor', () => {
    // Opposite direction: the one-shot implementation must be gone, not merely supplemented.
    expect(src).not.toMatch(/\$in:\s*idS/);
    expect(src).not.toMatch(/Policy\.find\([^)]*\)\.fetchAsync\(\)/);
  });
});

/* eslint-disable no-undef */
// Static-source regression for a DDP hardening finding (HIGH):
// the Messages.Create status side-effect (type ∈ {changeComponentStatus,
// resetComponentStatus, componentComment}) used to resolve and UPDATE the module
// by raw client `moduleId` with NO company scope - a cross-tenant WRITE IDOR: a
// Company-A user could overwrite Company-B's `componentConfig.changedStatus` and
// fan notifications into B. The attribution fix scoped the *message* but not
// the *module write*. The fix scopes the lookup to the resolved sender's company
// (`{_id: moduleId, companyId: user.profile.companyId}`), string-validates the id,
// and throws 403 (skipping the update + sendMessageToFollowers) when it does not
// resolve. The live cross-tenant denial is covered by regress-tenant-full.mjs; this
// guards the scoping shape from silently regressing (mirrors
// approves-create-scope.unit.spec.js).
//
// Source-text assertion (no Meteor import) so the jest harness runs it serverless.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../imports/lib/interactors/messages/create.js'),
  'utf8'
);
const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#85 Finding 1 - Messages.Create module side-effect company scope', () => {
  it('validates moduleId is a non-empty string before the side-effect lookup (Invalid id 400)', () => {
    expect(code).toMatch(/typeof moduleId !== 'string'/);
    expect(code).toContain("'Invalid id'");
  });

  it('scopes the side-effect module lookup to {_id: moduleId, companyId}', () => {
    expect(code).toMatch(/Modules\.findOneAsync\(\s*\{\s*_id:\s*moduleId,\s*companyId\s*\}/);
  });

  it('binds the scope to the resolved sender company, not this.connection', () => {
    // The companyId used in the scoped lookup must be the same value written to the
    // message doc (user.profile.companyId) - works for client AND server-internal
    // follower/notify paths. It must NOT branch on this.connection.
    expect(code).toMatch(/companyId\s*=\s*user[\s\S]*?user\.profile\.companyId/);
    expect(code).not.toMatch(/this\.connection/);
  });

  it('denies (403) a moduleId that does not resolve in the sender company', () => {
    expect(code).toMatch(/if\s*\(\s*!module\s*\)/);
    expect(code).toContain("'Access Denied'");
  });

  // The vulnerable shape was a raw-id, unscoped lookup. Make sure no such
  // single-arg-object lookup keyed only on `_id: moduleId` survives in the
  // side-effect block (the followers helper find is a separate, name/relatedUsers
  // projected, server-internal lookup and is allowed).
  it('contains no unscoped {_id: moduleId} side-effect lookup (no companyId)', () => {
    expect(code).not.toMatch(/Modules\.findOneAsync\(\s*\{\s*_id:\s*moduleId\s*\}\s*\)/);
  });

  it('still guards the side-effect on the status / comment types only', () => {
    expect(code).toContain("'changeComponentStatus'");
    expect(code).toContain("'resetComponentStatus'");
    expect(code).toContain("'componentComment'");
  });
});

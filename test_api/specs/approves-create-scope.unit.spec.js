/* eslint-disable no-undef */
// Static-source regression: Approves.Create must scope the projectId /
// moduleId lookups to the caller's company (server-derived companyId) so a
// cross-tenant id cannot leak another tenant's relatedUsers
// (defaultComplianceManager) into the approve's assignment. The live cross-tenant
// denial + the apiUser own-company positive control are covered by
// regress-tenant-full.mjs and approves.spec.js respectively; this guards the
// scoping shape from silently regressing.
//
// Source-text assertion (no Meteor import) so the jest harness runs it serverless.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../imports/lib/interactors/approves/create.js'),
  'utf8'
);
const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#84 Approves.Create company-scoped id lookups', () => {
  it('derives companyId server-side (not from a client field)', () => {
    expect(code).toMatch(/const companyId\s*=\s*user\.profile\.companyId/);
  });

  it('scopes the project lookup to {_id: projectId, companyId}', () => {
    expect(code).toMatch(/Projects\.findOneAsync\(\s*\{\s*_id:\s*projectId,\s*companyId\s*\}/);
  });

  it('scopes the module lookup to {_id: moduleId, companyId}', () => {
    expect(code).toMatch(/Modules\.findOneAsync\(\s*\{\s*_id:\s*moduleId,\s*companyId\s*\}/);
  });

  it('validates projectId / moduleId are strings (Invalid id 400)', () => {
    expect(code).toMatch(/typeof projectId !== 'string'/);
    expect(code).toMatch(/typeof moduleId !== 'string'/);
    expect(code).toContain("'Invalid id'");
  });

  it('denies (403) a supplied id that does not resolve in the caller company', () => {
    expect(code).toMatch(/if\s*\(\s*projectId\s*&&\s*!project\s*\)/);
    expect(code).toMatch(/if\s*\(\s*moduleId\s*&&\s*!module\s*\)/);
    expect(code).toContain("'Access Denied'");
  });

  it('does NOT branch on this/this.connection (createFromDraft plain-function path)', () => {
    expect(code).not.toMatch(/this\.connection/);
  });

  // A missing id must yield `null`, never an unscoped/match-all lookup. The
  // ternary `projectId ? find({_id, companyId}) : null` is what makes the
  // company scope unconditional - guard that shape from regressing to an
  // always-run find.
  it('guards the project lookup behind a truthy projectId (no match-all on null id)', () => {
    expect(code).toMatch(/projectId\s*\?\s*await\s+Projects\.findOneAsync\([^)]*\)\s*:\s*null/s);
  });

  it('guards the module lookup behind a truthy moduleId (no match-all on null id)', () => {
    expect(code).toMatch(/moduleId\s*\?\s*await\s+Modules\.findOneAsync\([^)]*\)\s*:\s*null/s);
  });

  // The old code resolved a project/module by raw id with NO company scope. Make
  // sure no such unscoped single-id lookup survives anywhere in the file.
  it('contains no unscoped raw-id Projects/Modules.findOneAsync(projectId|moduleId, ...)', () => {
    expect(code).not.toMatch(/Projects\.findOneAsync\(\s*projectId\b/);
    expect(code).not.toMatch(/Modules\.findOneAsync\(\s*moduleId\b/);
  });

  // relatedUsers (the cross-tenant leak surface - defaultComplianceManager) is
  // only read off the company-scoped, resolved docs - never off a raw client id.
  it('reads relatedUsers/defaultComplianceManager only off the resolved docs', () => {
    expect(code).toMatch(/module\.relatedUsers/);
    expect(code).toMatch(/project\.relatedUsers/);
    expect(code).toContain('defaultComplianceManager');
  });
});

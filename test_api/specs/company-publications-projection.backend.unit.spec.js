/* eslint-disable no-undef */
// Regression for the "Minimongo doesn't support operators in projections yet"
// crash on the `company` and `companyFull` publications.
//
// Both publications used a `{statistics: {$slice: -1}}` projection to trim the
// statistics history on the wire. A `$slice` (or any operator) projection is
// fine for a one-time server-side find/fetch, but Meteor 3's reactive observe
// driver (ChangeStreamObserveDriver) compiles EVERY publish cursor's projection
// through Minimongo's `_compileProjection`, which rejects operator projections
// and throws - killing the whole publication. For companyFull that meant the
// account_admin settings UI received no company doc at all and the API keys page
// rendered an empty list.
//
// WHY the existing companyFull.publication.spec.js (mocha/meteor-test) did NOT
// catch it: that spec exercises the handler with `cursor.fetchAsync()`, a
// one-time fetch that DOES support `$slice` - the crash only happens on the
// reactive `_observeChanges` path a real DDP subscription takes. This static
// source spec locks the projections to an operator-free form so the class of
// bug is caught without standing up a live reactive subscription.
//
// WHY source-text pattern matching (same rationale as the *.frontend.unit specs
// in this dir): no Blaze/Minimongo reactive-observe harness is wired into jest.
const fs = require('fs');
const path = require('path');

const companiesRaw = fs.readFileSync(
  path.join(__dirname, '../../imports/server/collections/companies.js'), 'utf8');
// Strip comments so an explanatory `{$slice}` mention in a comment can't trip
// the assertions (the fix comments deliberately name the broken pattern).
const companiesCode = companiesRaw
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('company/companyFull publications no longer use an operator projection (Minimongo crash regression)', () => {
  it('no `statistics: {$slice ...}` projection survives (the exact crashing pattern)', () => {
    expect(companiesCode).not.toMatch(/statistics:\s*\{\s*\$slice/);
  });

  it('the `company` publication find() carries no projection operator', () => {
    const pub = companiesCode.match(/Meteor\.publish\('company',[\s\S]*?\n\}\);/);
    expect(pub).not.toBeNull();
    expect(pub[0]).not.toMatch(/\$slice/);
    expect(pub[0]).toMatch(/statistics:\s*0\b/);
  });

  it('the `companyFull` publication find() carries no projection operator', () => {
    const pub = companiesCode.match(/Meteor\.publish\('companyFull',[\s\S]*?\n\}\);/);
    expect(pub).not.toBeNull();
    expect(pub[0]).not.toMatch(/\$slice/);
    expect(pub[0]).toMatch(/statistics:\s*0\b/);
  });

  it('the statistics WRITE path still caps history with $push/$slice (unrelated, must NOT be removed)', () => {
    // A $slice inside a $push modifier is a valid write-time array cap - the fix
    // must only touch the read-time projection, not this.
    expect(companiesCode).toMatch(/\$push:\s*\{\s*'statistics':\s*\{\s*\$each:[\s\S]*?\$slice:\s*-100/);
  });
});

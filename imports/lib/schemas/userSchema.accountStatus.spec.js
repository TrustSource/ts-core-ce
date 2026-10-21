import {UserSchema} from './userSchema';
import {expect} from 'chai';

// Defensive account-status hardening: the schema RECOGNISES the
// three read-only fields (so ts-app can read them without clean() stripping
// them) and adds a top-level write barrier via a `custom` validator that fails
// any modifier which sets them. NOTE: this schema `custom` is defence-in-depth
// only - it does NOT catch dotted sub-paths of the blackbox sub-docs
// (e.g. {$set:{'accountClearing.score':9}}); the before.update collection hook
// is the authoritative barrier for those (see users.accountStatus.spec.js).
describe('UserSchema account-status hardening', function () {

  // NOTE: this vendored simple-schema (aldeed:simple-schema@2.0.0) exposes
  // `validationErrors()` (array of {name, type, value}); the legacy
  // `invalidKeys()` was removed. `keyIsInvalid(name)` and `isValid()` remain.
  function errorFor(context, name) {
    return context.validationErrors().find(function (k) {
      return k.name === name;
    });
  }

  it('rejects a $set modifier of accountStatus with type noWriteAccountStatus', function () {
    const context = UserSchema.newContext();
    context.validate({$set: {accountStatus: 'active'}}, {modifier: true});
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('accountStatus')).to.be.true;
    const invalid = errorFor(context, 'accountStatus');
    expect(invalid).to.exist;
    expect(invalid.type).to.equal('noWriteAccountStatus');
  });

  it('rejects a $set modifier of accountStatusInfo', function () {
    const context = UserSchema.newContext();
    context.validate({$set: {accountStatusInfo: {reason: 'x'}}}, {modifier: true});
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('accountStatusInfo')).to.be.true;
    expect(errorFor(context, 'accountStatusInfo').type).to.equal('noWriteAccountStatus');
  });

  it('rejects a $set modifier of accountClearing', function () {
    const context = UserSchema.newContext();
    context.validate({$set: {accountClearing: {score: 1}}}, {modifier: true});
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('accountClearing')).to.be.true;
    expect(errorFor(context, 'accountClearing').type).to.equal('noWriteAccountStatus');
  });

  it('rejects an accountStatus value outside the allowed enum', function () {
    const user = baseValidUser();
    user.accountStatus = 'bogus';
    const context = UserSchema.newContext();
    context.validate(user);
    expect(context.keyIsInvalid('accountStatus')).to.be.true;
    expect(errorFor(context, 'accountStatus').type).to.equal('notAllowed');
  });

  it('validates a plain (non-modifier) doc that READS these fields', function () {
    const user = baseValidUser();
    user.accountStatus = 'suspended';
    user.accountStatusInfo = {
      action: 'suspend',
      reason: 'fraud signal',
      at: new Date(),
      by: {userId: 'admin1', name: 'Admin'}
    };
    user.accountClearing = {score: 42, reason: 'auto'};
    const context = UserSchema.newContext();
    context.validate(user);
    expect(context.validationErrors()).to.deep.equal([]);
    expect(context.isValid()).to.be.true;
  });
});

// A known-valid user document (mirrors the github-user fixture in
// userSchema.spec.js) used as the base for read/insert assertions.
function baseValidUser() {
  return {
    createdAt: new Date('2015-03-08T20:13:11.905Z'),
    profile: {
      name: 'Jane Example',
      companyId: 'bwat59Bn6cneY7SRi',
      email: 'jane@example.com'
    },
    roles: {
      bwat59Bn6cneY7SRi: ['manager']
    },
    services: {
      resume: {loginTokens: []}
    }
  };
}

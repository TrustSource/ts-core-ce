import {validateLoginAttempt} from './accounts';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';

// Gap coverage for the validateLoginAttempt account-status gate.
//
// accounts.accountStatus.spec.js already covers: deny suspended/suspicious on
// login+resume, allow active, allow absent-status, and the no-2fa-code re-throw.
// These add the cases NOT covered there:
//   - attempt.user is undefined (failed login / user-not-found): must NOT throw
//     and must return attempt.allowed untouched.
//   - the invalid-2fa-code error path also re-throws (only no-2fa-code was tested).
//   - the gate faithfully returns attempt.allowed (false stays false) for an
//     active user, rather than hard-coding true.
describe('validateLoginAttempt account-status gate gaps (#95)', function () {

  beforeEach(function () {
    sinon.stub(Meteor, 'callAsync').resolves();
  });

  afterEach(function () {
    Meteor.callAsync.restore();
  });

  it('does not throw when attempt.user is undefined and returns attempt.allowed (false)', async function () {
    const result = await validateLoginAttempt({type: 'login', methodName: 'login', allowed: false});
    expect(result).to.be.false;
  });

  it('does not throw when attempt.user is undefined and returns attempt.allowed (true)', async function () {
    const result = await validateLoginAttempt({type: 'login', methodName: 'login', allowed: true});
    expect(result).to.be.true;
  });

  it('re-throws an invalid-2fa-code error unchanged', async function () {
    const twoFaError = {error: 'invalid-2fa-code'};
    let thrown;
    try {
      await validateLoginAttempt({type: 'login', methodName: 'login', error: twoFaError});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.equal(twoFaError);
  });

  it('returns false for an active user whose attempt was not allowed', async function () {
    const result = await validateLoginAttempt({
      type: 'login',
      methodName: 'login',
      allowed: false,
      user: {
        _id: 'u2',
        accountStatus: 'active',
        emails: [{address: 'a@b.com', verified: true}],
        profile: {name: 'Active'}
      }
    });
    expect(result).to.be.false;
  });

  it('still records the attempt via LoginsHistory.Create before gating', async function () {
    await validateLoginAttempt({type: 'login', methodName: 'login', allowed: true});
    expect(Meteor.callAsync.calledWithMatch('LoginsHistory.Create')).to.be.true;
  });

  it('the account-suspended error carries a human-readable reason for the UI', async function () {
    let thrown;
    try {
      await validateLoginAttempt({
        type: 'login', methodName: 'login', allowed: true,
        user: {_id: 'u3', accountStatus: 'suspended', emails: [{address: 's@b.com', verified: true}], profile: {name: 'S'}}
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.an.instanceof(Meteor.Error);
    expect(thrown.error).to.equal('account-suspended');
    expect(thrown.reason).to.be.a('string').and.to.have.length.above(0);
  });
});

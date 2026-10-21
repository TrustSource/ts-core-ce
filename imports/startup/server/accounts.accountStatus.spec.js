import {validateLoginAttempt} from './accounts';
import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';

// Login / resume gate for suspended accounts. validateLoginAttempt
// must deny access for a suspicious/suspended user on ANY attempt type (login,
// resume, ...) by throwing a distinct 'account-suspended' Meteor.Error so the
// login screen can show a clear reason, while leaving the 2FA pass-through
// errors and the active/absent paths intact.
async function expectSuspendedThrow(attempt) {
  let thrown;
  try {
    await validateLoginAttempt(attempt);
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'expected a thrown error').to.be.an.instanceof(Meteor.Error);
  expect(thrown.error).to.equal('account-suspended');
}
describe('validateLoginAttempt account-status gate (#95)', function () {

  beforeEach(function () {
    // LoginsHistory.Create is called first thing inside validateLoginAttempt.
    sinon.stub(Meteor, 'callAsync').resolves();
  });

  afterEach(function () {
    Meteor.callAsync.restore();
  });

  function attemptFor(status, type) {
    return {
      type: type,
      methodName: type === 'resume' ? 'resume' : 'login',
      allowed: true,
      user: {
        _id: 'u1',
        accountStatus: status,
        emails: [{address: 'x@y.com', verified: true}],
        profile: {name: 'X'}
      }
    };
  }

  it('denies a suspended user on a login attempt (throws account-suspended)', async function () {
    await expectSuspendedThrow(attemptFor('suspended', 'login'));
  });

  it('denies a suspended user on a resume attempt (throws account-suspended)', async function () {
    await expectSuspendedThrow(attemptFor('suspended', 'resume'));
  });

  it('denies a suspicious user on a login attempt (throws account-suspended)', async function () {
    await expectSuspendedThrow(attemptFor('suspicious', 'login'));
  });

  it('denies a suspicious user on a resume attempt (throws account-suspended)', async function () {
    await expectSuspendedThrow(attemptFor('suspicious', 'resume'));
  });

  it('allows an active user (returns attempt.allowed)', async function () {
    const result = await validateLoginAttempt(attemptFor('active', 'login'));
    expect(result).to.be.true;
  });

  it('allows a user with no accountStatus field (returns attempt.allowed)', async function () {
    const result = await validateLoginAttempt(attemptFor(undefined, 'login'));
    expect(result).to.be.true;
  });

  it('does not swallow a 2FA error (still throws it)', async function () {
    const twoFaError = {error: 'no-2fa-code'};
    let thrown;
    try {
      await validateLoginAttempt({type: 'login', methodName: 'login', error: twoFaError});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.equal(twoFaError);
  });
});

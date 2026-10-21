import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import reset2fa from './reset2fa';
import {reset2faForEmail} from '/imports/startup/server/reset-2fa';

// A user who lost their authenticator can be let in again (#41).
describe('2FA reset (#41)', function () {
  const companyId = 'cmpReset2faSpec12';
  const admin = {_id: 'admReset2faSpec12', profile: {companyId, name: 'Admin'}};
  let userId;

  beforeEach(async function () {
    userId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'reset-2fa-41@example.com', verified: true}],
      profile: {companyId, name: 'Locked Out', email: 'reset-2fa-41@example.com'},
      services: {twoFactorAuthentication: {secret: 'SECRET', type: 'otp'}}
    });
  });

  afterEach(async function () {
    sinon.restore();
    await Meteor.users.removeAsync(userId);
  });

  async function twoFactor() {
    const user = await Meteor.users.findOneAsync(userId, {fields: {services: 1}});
    return user.services && user.services.twoFactorAuthentication;
  }

  describe('Users.Reset2fa', function () {
    let roleStub;
    let assignmentStub;

    beforeEach(function () {
      sinon.stub(Meteor, 'userAsync').resolves(admin);
      roleStub = sinon.stub(Roles, 'userIsInRoleAsync').resolves(true);
      assignmentStub = sinon.stub(Meteor.roleAssignment, 'findOneAsync').resolves({_id: 'ra'});
      const callAsync = Meteor.callAsync;
      sinon.stub(Meteor, 'callAsync').callsFake(function (name, ...args) {
        return name === 'logEvent' ? Promise.resolve() : callAsync.call(Meteor, name, ...args);
      });
    });

    it('turns off 2FA of a company user', async function () {
      expect(await reset2fa(userId)).to.equal(1);
      expect(await twoFactor()).to.be.undefined;
      expect(await reset2fa(userId)).to.equal(0);
    });

    it('refuses callers without the Account admin role and users of other companies', async function () {
      roleStub.resolves(false);
      let err;
      try { await reset2fa(userId); } catch (e) { err = e; }
      expect(err && err.error).to.equal(403);
      roleStub.resolves(true);
      assignmentStub.resolves(undefined);
      err = undefined;
      try { await reset2fa(userId); } catch (e) { err = e; }
      expect(err && err.error).to.equal(404);
      expect((await twoFactor()).type).to.equal('otp');
    });

    it('refuses the own account', async function () {
      let err;
      try { await reset2fa(admin._id); } catch (e) { err = e; }
      expect(err && err.error).to.equal(400);
    });
  });

  describe('TS_RESET_2FA', function () {
    it('turns off 2FA of the given login', async function () {
      sinon.stub(console, 'log');
      expect(await reset2faForEmail(' reset-2fa-41@example.com ')).to.equal(1);
      expect(await twoFactor()).to.be.undefined;
    });

    it('does nothing without a value or for an unknown login', async function () {
      sinon.stub(console, 'warn');
      expect(await reset2faForEmail(undefined)).to.equal(null);
      expect(await reset2faForEmail('nobody@example.com')).to.equal(0);
      expect((await twoFactor()).type).to.equal('otp');
    });
  });
});

import '/imports/server/collections/users';
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import setAccountStatus from './setAccountStatus';

// Users.SetAccountStatus: the Account admin's Suspend / Reactivate in CE, the only
// in-process writer of the otherwise write-locked accountStatus field.
describe('interactor: Users.SetAccountStatus (#23)', function () {
  const companyId = 'cmpSetStatus12345';
  const admin = {_id: 'admSetStatus12345', profile: {companyId, name: 'Admin'}};
  let targetId;
  let userStub;
  let roleStub;
  let assignmentStub;
  let logStub;

  beforeEach(async function () {
    targetId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'set-status-23@example.com', verified: true}],
      profile: {companyId, name: 'Target', email: 'set-status-23@example.com'},
      services: {resume: {loginTokens: [{hashedToken: 'x', when: new Date()}]}}
    });
    userStub = sinon.stub(Meteor, 'userAsync').resolves(admin);
    roleStub = sinon.stub(Roles, 'userIsInRoleAsync').resolves(true);
    assignmentStub = sinon.stub(Meteor.roleAssignment, 'findOneAsync').resolves({_id: 'ra'});
    const callAsync = Meteor.callAsync;
    logStub = sinon.stub(Meteor, 'callAsync').callsFake(function (name, ...args) {
      return name === 'logEvent' ? Promise.resolve() : callAsync.call(Meteor, name, ...args);
    });
  });

  afterEach(async function () {
    sinon.restore();
    await Meteor.users.removeAsync(targetId);
  });

  async function reload() {
    return Meteor.users.findOneAsync(targetId, {fields: {accountStatus: 1, accountStatusInfo: 1, services: 1}});
  }

  it('suspends a company user, records who did it and ends their sessions', async function () {
    expect(await setAccountStatus(targetId, 'suspended')).to.equal(1);
    const user = await reload();
    expect(user.accountStatus).to.equal('suspended');
    expect(user.accountStatusInfo.action).to.equal('suspend');
    expect(user.accountStatusInfo.by.userId).to.equal(admin._id);
    expect(user.services.resume.loginTokens).to.deep.equal([]);
    expect(logStub.calledWith('logEvent')).to.equal(true);
  });

  it('reactivates a suspended user', async function () {
    await setAccountStatus(targetId, 'suspended');
    await setAccountStatus(targetId, 'active');
    expect((await reload()).accountStatus).to.equal('active');
  });

  it('refuses callers without the Account admin role', async function () {
    roleStub.resolves(false);
    let err;
    try { await setAccountStatus(targetId, 'suspended'); } catch (e) { err = e; }
    expect(err && err.error).to.equal(403);
    expect((await reload()).accountStatus).to.be.undefined;
  });

  it('refuses users of another company, unknown statuses and the own account', async function () {
    assignmentStub.resolves(undefined);
    let err;
    try { await setAccountStatus(targetId, 'suspended'); } catch (e) { err = e; }
    expect(err && err.error).to.equal(404);
    assignmentStub.resolves({_id: 'ra'});
    err = undefined;
    try { await setAccountStatus(targetId, 'suspicious'); } catch (e) { err = e; }
    expect(err && err.error).to.equal(400);
    err = undefined;
    try { await setAccountStatus(admin._id, 'suspended'); } catch (e) { err = e; }
    expect(err && err.error).to.equal(400);
    expect(userStub.called).to.equal(true);
  });

  it('keeps accountStatus locked for every other updateAsync', async function () {
    let err;
    try { await Meteor.users.updateAsync(targetId, {$set: {accountStatus: 'suspended'}}); } catch (e) { err = e; }
    expect(err && err.error).to.equal(403);
  });
});

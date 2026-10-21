import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import Companies from '/imports/lib/collections/companies';
import remove from './remove';

describe('interactor: Users.Remove', function () {
  const companyId = 'cmpRemoveSpec1234';
  const admin = {_id: 'admRemoveSpec1234', profile: {companyId, name: 'Admin'}};
  let userId;

  beforeEach(async function () {
    await Meteor.users.rawCollection().insertOne(Object.assign({createdAt: new Date()}, admin));
    userId = await Meteor.users.insertAsync({
      createdAt: new Date(),
      emails: [{address: 'remove-spec@example.com', verified: true}],
      profile: {companyId, name: 'Leaving'}
    });
    await Companies.rawCollection().insertOne({_id: companyId, apiKeys: [
      {id: 'pak', userId, published: true, scope: ['developer']},
      {id: 'company', published: true, scope: ['manager']}
    ]});
    sinon.stub(Meteor, 'userAsync').resolves(admin);
    sinon.stub(Roles, 'getRolesForUserAsync').resolves(['developer']);
    sinon.stub(Roles, 'removeUsersFromRolesAsync').resolves();
    sinon.stub(Roles, 'getScopesForUserAsync').resolves([]);
    const callAsync = Meteor.callAsync;
    sinon.stub(Meteor, 'callAsync').callsFake(function (name, ...args) {
      return name === 'logEvent' ? Promise.resolve() : callAsync.call(Meteor, name, ...args);
    });
  });

  afterEach(async function () {
    sinon.restore();
    await Meteor.users.removeAsync(userId);
    await Meteor.users.removeAsync(admin._id);
    await Companies.rawCollection().deleteOne({_id: companyId});
  });

  it('#49 refuses callers without the Account admin role', async function () {
    const roleStub = sinon.stub(Roles, 'userIsInRoleAsync').resolves(false);
    let err;
    try { await remove(userId, companyId); } catch (e) { err = e; }
    expect(err && err.error).to.equal(403);
    expect(roleStub.firstCall.args[1]).to.deep.equal(['account_admin']);
  });

  it('#44 unpublishes the personal access keys of the removed user only', async function () {
    sinon.stub(Roles, 'userIsInRoleAsync').resolves(true);
    await remove(userId, companyId);
    const keys = (await Companies.rawCollection().findOne({_id: companyId})).apiKeys;
    expect(keys.find((k) => k.id === 'pak')).to.include({published: false, unpublished: true});
    expect(keys.find((k) => k.id === 'company').published).to.equal(true);
  });
});

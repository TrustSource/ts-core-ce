import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import create from './create';

// Starting an approval needs Manager or Compliance manager (#43).
describe('interactor: Approves.Create role check (#43)', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('refuses a signed-in user without an approval role', async function () {
    sinon.stub(Meteor, 'userAsync').resolves({_id: 'devUser1234567890', profile: {companyId: 'cmpApprRole123456'}});
    const roleStub = sinon.stub(Roles, 'userIsInRoleAsync').resolves(false);
    let err;
    try {
      await create({projectId: 'p1', modules: []});
    } catch (e) {
      err = e;
    }
    expect(err && err.error).to.equal(403);
    expect(roleStub.firstCall.args[1]).to.deep.equal(['manager', 'compliance_manager']);
  });

  it('refuses a call with neither a session nor an API user', async function () {
    sinon.stub(Meteor, 'userAsync').resolves(null);
    let err;
    try {
      await create({projectId: 'p1', modules: []});
    } catch (e) {
      err = e;
    }
    expect(err && err.error).to.equal(403);
  });
});

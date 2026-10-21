import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';
import Capabilities from '/imports/lib/collections/capabilities';
import create from './create';

// A capability records who added it, not "anonymous" (#65).
describe('interactor: Capabilities.Create (#65)', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('stores the calling user\'s name', async function () {
    sinon.stub(Meteor, 'userAsync').resolves({_id: 'usrCapability1234', profile: {companyId: 'cmpCapability1234', name: 'Jane Doe'}});
    const insert = sinon.stub(Capabilities, 'insertAsync').resolves('cap1');
    sinon.stub(Meteor, 'callAsync').resolves();
    await create({projectId: 'p1', moduleId: 'm1', name: 'Login', version: '1', description: 'x'});
    expect(insert.firstCall.args[0].userName).to.equal('Jane Doe');
    expect(insert.firstCall.args[0].userId).to.equal('usrCapability1234');
  });

  it('refuses a call without a user', async function () {
    sinon.stub(Meteor, 'userAsync').resolves(null);
    let err;
    try { await create({name: 'x'}); } catch (e) { err = e; }
    expect(err && err.error).to.equal(403);
  });
});

import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import LogEvents from '/imports/lib/collections/logevents';
import Tasks from '/imports/lib/collections/tasks';
import executeRtbf from './executeRtbf';

// RTBF must anonymise every document of the user, not the first one per collection (#39).
describe('interactor: Users.ExecuteRtbf (#39)', function () {
  const companyId = 'cmpRtbfSpec123456';
  const userId = 'usrRtbfSpec123456';
  const admin = {_id: 'admRtbfSpec123456', profile: {companyId}};

  beforeEach(async function () {
    sinon.stub(Meteor, 'userAsync').resolves(admin);
    sinon.stub(Roles, 'userIsInRole').resolves(true);
    const callAsync = Meteor.callAsync;
    sinon.stub(Meteor, 'callAsync').callsFake(function (name, ...args) {
      return name === 'logEvent' ? Promise.resolve() : callAsync.call(Meteor, name, ...args);
    });
    for (const i of [1, 2, 3]) {
      await LogEvents.rawCollection().insertOne({_id: `rtbfLog${i}`, userId, companyId, userName: 'Jane Doe'});
    }
    await Tasks.rawCollection().insertOne({_id: 'rtbfTask1', userId, companyId, userName: 'Jane Doe'});
    await Tasks.rawCollection().insertOne({_id: 'rtbfTask2', userId, companyId, userName: 'Jane Doe'});
    await LogEvents.rawCollection().insertOne({_id: 'rtbfOther', userId: 'someoneElse12345', companyId,
      userName: 'Other'});
  });

  afterEach(async function () {
    sinon.restore();
    await LogEvents.rawCollection().deleteMany({_id: {$in: ['rtbfLog1', 'rtbfLog2', 'rtbfLog3', 'rtbfOther']}});
    await Tasks.rawCollection().deleteMany({_id: {$in: ['rtbfTask1', 'rtbfTask2']}});
  });

  it('replaces the name in every document of the user', async function () {
    const total = await executeRtbf(userId, companyId, {rtbf: 'RTBF_USED'});
    expect(total).to.equal(5);
    const names = (await LogEvents.rawCollection().find({userId}).toArray()).map((d) => d.userName);
    expect(names).to.deep.equal(['RTBF_USED', 'RTBF_USED', 'RTBF_USED']);
    const taskNames = (await Tasks.rawCollection().find({userId}).toArray()).map((d) => d.userName);
    expect(taskNames).to.deep.equal(['RTBF_USED', 'RTBF_USED']);
    expect((await LogEvents.rawCollection().findOne({_id: 'rtbfOther'})).userName).to.equal('Other');
  });
});

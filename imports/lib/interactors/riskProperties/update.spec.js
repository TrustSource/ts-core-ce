import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';
import RiskProperties from '/imports/lib/collections/riskProperties';
import update from './update';

// Risk edits and countermeasure changes are written to the audit log (#31).
describe('interactor: RiskProperties.Update audit log (#31)', function () {
  const user = {_id: 'usrRiskUpdate1234', profile: {companyId: 'cmpRiskUpdate1234', name: 'Risk Editor'}};
  let updateStub;
  let logStub;

  beforeEach(function () {
    sinon.stub(Meteor, 'userAsync').resolves(user);
    updateStub = sinon.stub(RiskProperties, 'updateAsync').resolves(1);
    sinon.stub(RiskProperties, 'findOneAsync').resolves({_id: 'r1', name: 'SQL injection'});
    logStub = sinon.stub(Meteor, 'callAsync').resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  it('logs an edit with the changed fields', async function () {
    await update({$set: {name: 'SQL injection', 'riskProperties.description': 'x'}}, 'r1');
    expect(logStub.calledOnce).to.equal(true);
    const [method, actor, message, type] = logStub.firstCall.args;
    expect(method).to.equal('logEvent');
    expect(actor).to.equal(user);
    expect(type).to.equal('riskPropertiesUpdate');
    expect(message).to.equal('Risk SQL injection updated (name, riskProperties.description)');
  });

  it('logs a countermeasure change with its own type', async function () {
    await update({$set: {'riskProperties.countermeasures': [{countermeasure: 'patch'}]}}, 'r1');
    expect(logStub.firstCall.args[3]).to.equal('riskPropertiesCountermeasuresUpdate');
    expect(logStub.firstCall.args[2]).to.contain('countermeasures updated');
  });

  it('writes no entry when nothing was updated', async function () {
    updateStub.resolves(0);
    await update({$set: {name: 'x'}}, 'r1');
    expect(logStub.called).to.equal(false);
  });
});

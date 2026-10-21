import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {expect} from 'chai';
import sinon from 'sinon';
import Projects from '/imports/lib/collections/projects';
import {ProjectSchema, PROJECT_DESCRIPTION_MAX} from '/imports/lib/schemas/projectSchema';
import updateArchitecture from './updateArchitecture';

// Regression lock: the `description` field's schema cap must
// track PROJECT_DESCRIPTION_MAX, not a stale literal. This is the most
// direct possible test for that specific class of regression - it caught a
// real bug where PROJECT_DESCRIPTION_MAX was introduced but `description.max`
// was left at the old literal 2000, which the interactor/REST size checks
// above never exercised (they run their OWN explicit size check and never
// touch ProjectSchema directly) but the EXISTING generic project POST
// endpoint does (via helpers.cleanAndValidateProject -> full schema
// validation), so any real architecture.md upload that later got re-saved
// through that path would have failed with "Application goals cannot exceed
// 2000 characters".
describe('ProjectSchema.description cap (issue #76 regression lock)', function () {
  it('description.max references PROJECT_DESCRIPTION_MAX, not a stale literal', function () {
    // aldeed:simple-schema 1.5.4 nests the resolved max under
    // getDefinition(key).type[N].max (schema(key).max is NOT the resolved
    // value - confirmed via meteor shell introspection). Behavioral
    // validation is the more direct regression lock, added below.
    expect(ProjectSchema.getDefinition('description').type[0].max).to.equal(PROJECT_DESCRIPTION_MAX);
  });

  it('validateOne accepts a ~10KB description (well over the old 2000-char literal cap)', function () {
    const ctx = ProjectSchema.newContext();
    const isValid = ctx.validateOne({$set: {description: 'A'.repeat(10 * 1024)}}, 'description', {modifier: true});
    expect(isValid).to.be.true;
  });

  it('validateOne rejects a description over PROJECT_DESCRIPTION_MAX', function () {
    const ctx = ProjectSchema.newContext();
    const isValid = ctx.validateOne(
      {$set: {description: 'A'.repeat(PROJECT_DESCRIPTION_MAX + 1)}}, 'description', {modifier: true});
    expect(isValid).to.be.false;
  });
});

// Server interactor for Projects.UpdateArchitecture (upload an
// architecture.md to populate a project's "Application goals" / `description`
// field). Runs under `meteor test` (the interactor imports meteor/meteor,
// meteor/alanning:roles, and a Mongo collection, so it cannot load under the
// pure-Jest test_api harness).
//
// We stub Meteor.userAsync (caller resolution), Roles.userIsInRole (RBAC),
// and the collection's findOneAsync/updateAsync so each validation branch and
// the persisted $set shape are asserted against the REAL interactor code.
describe('interactor: Projects.UpdateArchitecture', function () {
  const projectId = 'Pj1234567890abcde';
  const architectureDoc = [
    'This project implements an order-processing microservice using Node.js',
    'and MongoDB, deployed behind an API gateway. Goals: reduce end-to-end',
    'latency and improve resilience across regions.'
  ].join('\n');

  const user = {
    _id: 'usr1234567890abcd',
    profile: {companyId: 'cmp1234567890abcd', name: 'Jane Dev'}
  };

  let userStub;
  let roleStub;
  let findOneStub;
  let updateStub;

  function stubUser(u) {
    if (userStub) userStub.restore();
    userStub = sinon.stub(Meteor, 'userAsync').resolves(u);
  }

  beforeEach(function () {
    stubUser(user);
    roleStub = sinon.stub(Roles, 'userIsInRole').resolves(true);
    findOneStub = sinon.stub(Projects, 'findOneAsync')
      .resolves({_id: projectId, companyId: user.profile.companyId});
    updateStub = sinon.stub(Projects, 'updateAsync').resolves(1);
  });

  afterEach(function () {
    if (userStub) userStub.restore();
    userStub = null;
    roleStub.restore();
    findOneStub.restore();
    updateStub.restore();
  });

  it('throws 403 when there is no logged-in user', async function () {
    stubUser(null);
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err).to.be.an.instanceof(Meteor.Error);
    expect(err.error).to.equal(403);
    expect(updateStub.called).to.be.false;
  });

  it('throws 403 when the user has no companyId', async function () {
    stubUser({_id: 'u', profile: {}});
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(403);
    expect(updateStub.called).to.be.false;
  });

  it('throws 403 when the user is not in an allowed role', async function () {
    roleStub.resolves(false);
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(403);
    expect(updateStub.called).to.be.false;
  });

  it('throws 403 when the project is not found or belongs to another company', async function () {
    findOneStub.resolves(undefined);
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(403);
    expect(updateStub.called).to.be.false;
  });

  it('throws 403 when the project belongs to a different company', async function () {
    findOneStub.resolves({_id: projectId, companyId: 'other-company'});
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(403);
    expect(updateStub.called).to.be.false;
  });

  it('throws 400 for a non-string projectId', async function () {
    let err;
    try { await updateArchitecture(42, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(400);
    expect(err.reason).to.equal('Invalid id');
    expect(updateStub.called).to.be.false;
  });

  it('throws 400 for non-string content', async function () {
    let err;
    try { await updateArchitecture(projectId, {not: 'a string'}); } catch (e) { err = e; }
    expect(err.error).to.equal(400);
    expect(err.reason).to.equal('Invalid content');
    expect(updateStub.called).to.be.false;
  });

  it('throws 400 when content exceeds the size cap', async function () {
    let err;
    try { await updateArchitecture(projectId, 'x'.repeat(PROJECT_DESCRIPTION_MAX + 1)); } catch (e) { err = e; }
    expect(err.error).to.equal(400);
    expect(err.reason).to.equal('Content too large');
    expect(updateStub.called).to.be.false;
  });

  it('does not evaluate the project load before the cheaper checks (fail-fast order)', async function () {
    let err;
    try { await updateArchitecture(42, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(400);
    expect(findOneStub.called).to.be.false;
  });

  it('happy path: persists description via $set and returns the update count', async function () {
    const result = await updateArchitecture(projectId, architectureDoc);
    expect(result).to.equal(1);
    expect(updateStub.calledOnce).to.be.true;
    expect(updateStub.firstCall.args[0]).to.equal(projectId);
    expect(updateStub.firstCall.args[1]).to.deep.equal({$set: {description: architectureDoc}});
  });

  it('scopes the project load to the caller company', async function () {
    await updateArchitecture(projectId, architectureDoc);
    expect(findOneStub.firstCall.args[0]).to.equal(projectId);
  });

  it('throws 500 when the update count is not 1', async function () {
    updateStub.resolves(0);
    let err;
    try { await updateArchitecture(projectId, architectureDoc); } catch (e) { err = e; }
    expect(err.error).to.equal(500);
  });
});

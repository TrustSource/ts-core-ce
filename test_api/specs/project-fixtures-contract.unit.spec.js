/* eslint-disable no-undef */
// helpers/projectFixtures.js is the assertion for ~20 project-create sites across 16 spec
// files, and for the cleanup that follows them. Those sites can only run
// against a live app on :3000, so the helper itself - which is where their actual pass/fail
// logic now lives - was never exercised anywhere.
//
// That is the wrong way round: a bug in `expectProjectCreatedOrExisting` does not fail one
// spec, it silently changes what twenty assertions mean. A helper that accepted everything
// would leave all sixteen files green while checking nothing.
//
// Both functions are pure over a response object, so they can be exercised directly here,
// with no app. Each case asserts the direction that matters: the accepted responses must NOT
// throw, and every rejected one MUST - a test that only listed the accepted ones would pass
// against a helper whose body was deleted.
const {expectProjectCreatedOrExisting, expectProjectRemovedOrGone, removeProjectIfCreated} =
  require('../helpers/projectFixtures');

const response = (status, body) => ({status, body});

describe('expectProjectCreatedOrExisting accepts exactly the two contractual answers', () => {
  it('accepts 201 with a bare {projectId} - a real create', () => {
    expect(() => expectProjectCreatedOrExisting(response(201, {projectId: 'p-1'}))).not.toThrow();
  });

  it('accepts 200 with {projectId, existing: true} - the name was already taken', () => {
    expect(() => expectProjectCreatedOrExisting(
      response(200, {projectId: 'p-1', existing: true}))).not.toThrow();
  });

  it.each([
    // The flag is what tells a caller nothing was created, so a 200 without it is a contract
    // break even though the id is usable.
    ['200 without the existing flag', 200, {projectId: 'p-1'}],
    ['200 with existing: false', 200, {projectId: 'p-1', existing: false}],
    // ...and the other direction: a real create must keep the body it always had, or clients
    // that branch on `existing` start seeing it on every response.
    ['201 carrying an existing flag', 201, {projectId: 'p-1', existing: true}],
    ['201 carrying existing: false', 201, {projectId: 'p-1', existing: false}],
    ['200 with no projectId', 200, {existing: true}],
    ['201 with no projectId', 201, {}],
    ['a 400 from schema validation', 400, {error: 'Project: name is required'}],
    ['a 403 from an out-of-scope key', 403, {}],
    ['a 404', 404, {}],
    ['a 500', 500, {}]
  ])('rejects %s', (_label, status, body) => {
    expect(() => expectProjectCreatedOrExisting(response(status, body))).toThrow();
  });

  it('does not throw on a missing body, it reports the status', () => {
    // supertest hands back `undefined` for a non-JSON body; the helper must still produce a
    // readable failure rather than a TypeError that hides the real status.
    expect(() => expectProjectCreatedOrExisting({status: 502}))
      .toThrow(/502/);
  });

  it('returns undefined, so supertest does not read the result as an error', () => {
    // `.expect(fn)` treats ANY truthy return value as a failure, so a helper that ended in
    // an expression would fail every request it was attached to.
    expect(expectProjectCreatedOrExisting(response(201, {projectId: 'p-1'}))).toBeUndefined();
  });
});

describe('expectProjectRemovedOrGone accepts removal and prior removal, nothing else', () => {
  it('accepts 204 - the project was removed', () => {
    expect(() => expectProjectRemovedOrGone(response(204, {}))).not.toThrow();
  });

  it('accepts 404 - a concurrent demo reset had already removed it', () => {
    // Remove demo data in the app removes every `demo: true` project in the company, and
    // several of these fixtures are demo data, so it can land between beforeAll and afterAll.
    expect(() => expectProjectRemovedOrGone(response(404, {}))).not.toThrow();
  });

  it.each([
    // The status this assertion exists to catch: `?force=true` dropped, project owns a
    // module, delete refused - which is how fixture projects used to accumulate silently.
    ['400 - refused because the project owns a module', 400],
    ['403 - the key may create projects but not delete them', 403],
    ['200 - the route stopped answering 204', 200],
    ['500', 500]
  ])('rejects %s', (_label, status) => {
    expect(() => expectProjectRemovedOrGone(response(status, {}))).toThrow();
  });

  it('returns undefined so supertest does not read the result as an error', () => {
    expect(expectProjectRemovedOrGone(response(204, {}))).toBeUndefined();
  });
});

describe('removeProjectIfCreated deletes only what this run created', () => {
  // The guard matters more than the delete: force-deleting a project this run merely FOUND
  // would take every module under it with it, including another suite's fixtures. It is
  // asserted by the absence of a request - if the helper ever issued one, the unreachable
  // ROOT_URL would make these hang or throw rather than resolve to null.
  it.each([
    ['the project was only found, not created', 'p-1', false],
    ['there is no project id', undefined, true],
    ['there is neither', undefined, false],
    ['the id is an empty string', '', true]
  ])('issues no request when %s', async (_label, projectId, created) => {
    await expect(removeProjectIfCreated(projectId, created)).resolves.toBeNull();
  });
});

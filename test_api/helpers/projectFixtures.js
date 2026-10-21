// Creating and cleaning up the project a REST spec needs, now that `POST /api/v2/core/projects`
// is idempotent on {companyId, name}.
//
// WHY A HELPER. Twenty sites across sixteen spec files post a project and assert `201`. The
// endpoint answers `201` only for a name the company has not used yet; the SECOND run of the
// same suite against the same database gets `200 {projectId, existing: true}` instead - and
// several of these fixture projects are created without `demo: true`, so Remove demo data
// never removes them and the second run is the normal case, not the exception. Which of the
// two a spec sees is therefore a property of the database it happens to run against, and
// pinning either one makes the suite depend on leftover state. `expectProjectCreatedOrExisting`
// accepts both and still checks the contract in full, in one place.
//
// The cleanup half exists for the other end of the same defect: a project delete that omits
// `?force=true` is refused with 400 once the project owns a module, and every one of those
// call sites ignored the status - which is how duplicate-named projects accumulated run after
// run in the first place.
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');

// A trailing slash on ROOT_URL makes supertest build `//api/v2/...`, which the server routes
// do not match, so normalise it (same reason as helpers/scanFixtures.js).
const ROOT_URL = (process.env.ROOT_URL || '').replace(/\/+$/, '');
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

/**
 * A supertest `.expect(fn)` assertion for the create arm: throws to fail the request.
 *
 * `201 {projectId}` for a name this company has not used, `200 {projectId, existing: true}`
 * for one it has. Both directions of the `existing` flag are asserted, so a 201 that started
 * carrying it - or a 200 that stopped - is caught rather than tolerated.
 *
 * @param {Object} res the supertest response
 */
function expectProjectCreatedOrExisting(res) {
  const body = res.body || {};
  if (res.status !== StatusCodes.CREATED && res.status !== StatusCodes.OK) {
    throw new Error(`POST ${BASE}/core/projects answered ${res.status}; expected 201 (created) ` +
      `or 200 (name already present): ${JSON.stringify(body)}`);
  }
  if (!body.projectId) {
    throw new Error(`POST ${BASE}/core/projects answered ${res.status} without a projectId: ` +
      JSON.stringify(body));
  }
  if (res.status === StatusCodes.OK && body.existing !== true) {
    throw new Error('POST answered 200 without `existing: true`, so a caller cannot tell ' +
      'that nothing was created: ' + JSON.stringify(body));
  }
  if (res.status === StatusCodes.CREATED && body.existing !== undefined) {
    throw new Error('POST answered 201 carrying an `existing` flag; a real create must keep ' +
      'the original body shape: ' + JSON.stringify(body));
  }
}

/**
 * Create the project, or take the one that is already there.
 *
 * @param  {String} name    the project name
 * @param  {Object} [extra] further body fields (e.g. `{demo: true}`); IGNORED by the server
 *                          when the name already exists - see the OpenAPI description
 * @return {Object} {status, projectId, created} - `created` is false when this run merely
 *                  found the project, which is what removeProjectIfCreated keys off
 */
async function createProject(name, extra) {
  const response = await supertest(ROOT_URL).post(`${BASE}/core/projects`)
    .set('x-api-key', API_KEY)
    .send(Object.assign({name: name}, extra))
    .expect(expectProjectCreatedOrExisting);
  return {
    status: response.status,
    projectId: response.body.projectId,
    created: response.status === StatusCodes.CREATED
  };
}

/**
 * A supertest `.expect(fn)` assertion for the cleanup arm.
 *
 * 204 is the answer that means the project was removed. 404 is ACCEPTED as well, and only
 * 404: the project being gone already is the one outcome that is not a cleanup failure, and
 * it is reachable through no fault of the spec. Remove demo data in the app removes every
 * `demo: true` project in the company (removeDemoData -> `Projects.removeAsync({companyId,
 * demo: true})`), and several of these fixtures ARE demo data - so it can delete the
 * project between this spec's `beforeAll` and its `afterAll`. Asserting 204 alone would turn
 * that into a red suite in `afterAll`, which reports a cleanup bug where there is none.
 *
 * Every OTHER status still fails, which is the point of asserting at all:
 *   400 - `?force=true` was dropped and the project owns a module (how they used to leak)
 *   403 - the API key's scope covers creating projects but not deleting them
 *   200 - the route stopped answering 204
 *
 * @param {Object} res the supertest response
 */
function expectProjectRemovedOrGone(res) {
  if (res.status !== StatusCodes.NO_CONTENT && res.status !== StatusCodes.NOT_FOUND) {
    throw new Error(`DELETE ${BASE}/core/projects/:id?force=true answered ${res.status}; expected ` +
      `204 (removed) or 404 (already gone): ${JSON.stringify(res.body || {})}`);
  }
}

/**
 * Delete a fixture project, but ONLY when this run created it.
 *
 * `?force=true` is required: without it the endpoint refuses with 400 as soon as the project
 * owns a module, which is exactly the state a spec that imported anything leaves it in. The
 * status IS asserted, so a cleanup that silently stops working fails the spec that owns it
 * rather than leaking a project for the next run to trip over.
 *
 * It is skipped for a project this run only found, because force-deleting it would also
 * remove every module under it - and that project belongs to whichever run created it.
 *
 * @param {String}  projectId the project to remove
 * @param {Boolean} created   whether this run created it (from createProject)
 */
async function removeProjectIfCreated(projectId, created) {
  if (!projectId || !created) { return null; }
  return supertest(ROOT_URL).delete(`${BASE}/core/projects/${projectId}?force=true`)
    .set('x-api-key', API_KEY)
    .expect(expectProjectRemovedOrGone);
}

module.exports = {
  ROOT_URL,
  BASE,
  API_KEY,
  expectProjectCreatedOrExisting,
  expectProjectRemovedOrGone,
  createProject,
  removeProjectIfCreated
};

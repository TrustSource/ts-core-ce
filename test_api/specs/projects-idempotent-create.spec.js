/* eslint-disable no-undef, sonarjs/no-duplicate-string */
// `POST /api/v2/core/projects` used to insert unconditionally, so a client that
// re-posted a project it had already created got a SECOND row with the same name, and every
// ingest endpoint then resolved that name to whichever of them Mongo happened to return
// first. The create arm is now idempotent on {companyId, name}:
//
//   name not present in this company  ->  201 {projectId}
//   name already present              ->  200 {projectId: <the existing one>, existing: true}
//
// The tie-break and the warning are earned in project-resolution.unit.spec.js, which runs
// without an app. What is earned HERE is the wire contract - the status codes, the body
// shapes, that a repeat writes nothing, and that a 403 does not leak whether a name exists.
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {MongoClient} = require('mongodb');
const {describeWithMongo, connectMongo} = require('../helpers/gates');
const {createProject, removeProjectIfCreated,
  expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');

const ROOT_URL = (process.env.ROOT_URL || '').replace(/\/+$/, '');
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;
const PROJECTS_URL = `${BASE}/core/projects`;

// Run-unique, so the first POST below is genuinely a create whatever earlier runs left in
// the database - which is the only way `201 then 200` can be asserted rather than hoped for.
const RUN = Date.now();
const NAME = `TEST_IDEMPOTENT_${RUN}`;

// NOT async, and it must stay that way: `await`ing this function would resolve the supertest
// request itself - which sends it and yields a Response - so the caller's `.expect(...)` would
// land on a Response, where it is not a function. Callers do `await post(...).expect(...)`.
function post(body, apiKey) {
  const request = supertest(ROOT_URL).post(PROJECTS_URL).send(body);
  if (apiKey) { request.set('x-api-key', apiKey); }
  return request;
}

async function getProject(projectId) {
  const response = await supertest(ROOT_URL).get(`${PROJECTS_URL}/${projectId}`)
    .set('x-api-key', API_KEY)
    .expect(StatusCodes.OK);
  return response.body;
}

describe(`${PROJECTS_URL} create is idempotent on the project name (issue #136)`, () => {
  let projectId;
  let created = false;

  afterAll(async () => {
    await removeProjectIfCreated(projectId, created);
  });

  it('201 for a name this company has not used, with no `existing` flag', async () => {
    const response = await (post({name: NAME, description: 'first'}, API_KEY))
      .expect(StatusCodes.CREATED);
    expect(response.body).toHaveProperty('projectId');
    expect(response.body.existing).toBeUndefined();
    projectId = response.body.projectId;
    created = true;
  });

  it('200 with the SAME id on every repeat, instead of a second project', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await (post({name: NAME}, API_KEY)).expect(StatusCodes.OK);
      expect(response.body.projectId).toEqual(projectId);
      expect(response.body.existing).toEqual(true);
    }
  });

  it('a repeat carrying other fields leaves the stored project untouched', async () => {
    // `existing: true` is the only signal a client gets; the endpoint deliberately does not
    // double as an update (that is POST /projects/:id), so nothing on this body is written.
    const before = await getProject(projectId);

    await (post({
      name: NAME,
      description: 'a description the repeat must NOT apply',
      requireWhitelist: true
      // Every field here must be SCHEMA-VALID. Validation runs before the dedupe lookup, by
      // design, so an invalid one (`tags` needs real 17-char tag ids, not free strings) would
      // 400 and this would be testing validation instead of idempotency.
    }, API_KEY)).expect(StatusCodes.OK);

    expect(await getProject(projectId)).toEqual(before);
  });

  it('trims the name before matching, so "  NAME  " is not a second project', async () => {
    // ProjectSchema.clean() trims in place before validation, and the lookup runs after it.
    const response = await (post({name: `  ${NAME}  `}, API_KEY)).expect(StatusCodes.OK);
    expect(response.body.projectId).toEqual(projectId);
  });

  it('a different name is still a create', async () => {
    const other = await createProject(`${NAME}_OTHER`);
    try {
      expect(other.status).toEqual(StatusCodes.CREATED);
      expect(other.projectId).not.toEqual(projectId);
    } finally {
      await removeProjectIfCreated(other.projectId, other.created);
    }
  });

  it('an invalid name is still 400, and cannot match an existing project', async () => {
    // The lookup runs AFTER validation, so a name the schema rejects never reaches it.
    await (post({name: 'ab'}, API_KEY)).expect(StatusCodes.BAD_REQUEST);
  });

  it('401 without a key, identically for an existing and an unknown name', async () => {
    const existing = await (post({name: NAME})).expect(StatusCodes.UNAUTHORIZED);
    const unknown = await (post({name: `${NAME}_NO_SUCH_PROJECT`}))
      .expect(StatusCodes.UNAUTHORIZED);
    expect(existing.text).toEqual(unknown.text);
  });

  it('403 for a bad key, identically for an existing and an unknown name', async () => {
    // A create that answered differently for a name that exists would turn the refusal into
    // a project-name oracle. The scope check returns before the lookup runs at all.
    const existing = await (post({name: NAME}, 'SOMEKEY')).expect(StatusCodes.FORBIDDEN);
    const unknown = await (post({name: `${NAME}_NO_SUCH_PROJECT`}, 'SOMEKEY'))
      .expect(StatusCodes.FORBIDDEN);
    expect(existing.text).toEqual(unknown.text);
  });

  it('the helper every other spec now uses accepts both arms and nothing else', () => {
    expect(() => expectProjectCreatedOrExisting({status: 201, body: {projectId: 'p'}}))
      .not.toThrow();
    expect(() => expectProjectCreatedOrExisting(
      {status: 200, body: {projectId: 'p', existing: true}})).not.toThrow();
    expect(() => expectProjectCreatedOrExisting({status: 200, body: {projectId: 'p'}}))
      .toThrow(/existing/);
    expect(() => expectProjectCreatedOrExisting({status: 400, body: {}})).toThrow(/400/);
  });
});

// ── seeded duplicates ──────────────────────────────────────────────────────────────────
// The deterministic winner cannot be observed through the API alone: the endpoint no longer
// creates duplicates, so the only way to have some is to put them there. This block seeds
// them directly, which needs the app's own database - see helpers/gates.js.
//
// EVERYTHING IT INSERTS IS DELETED BY EXACT `_id`. Nothing here deletes by name, prefix or
// "looks orphaned", and the same selectors are re-counted afterwards so the spec proves the
// database came back rather than assuming it.
describeWithMongo()(`${PROJECTS_URL} resolves seeded duplicates to the oldest (issue #136)`, () => {
  const SEED_NAME = `TEST_IDEMPOTENT_DUP_${RUN}`;
  const FOREIGN_COMPANY = 'TESTFOREIGNCOMP01';
  // Insertion order is deliberately not the answer, and neither is `_id` order:
  // `_id` ascending gives `_newest`, insertion order gives `_newest`, and the winner is
  // `_undated` - a project with no recorded creationDate counts as the oldest.
  const SEEDED_IDS = [`${SEED_NAME}_newest`, `${SEED_NAME}_undated`, `${SEED_NAME}_oldest`];
  const FOREIGN_ID = `${SEED_NAME}_foreign`;

  let client;
  let db;
  let companyId;
  let probe;

  async function countOwn() {
    return db.collection('projects').countDocuments({companyId, name: SEED_NAME});
  }

  beforeAll(async () => {
    client = await connectMongo(MongoClient);
    db = client.db('meteor');

    // The company is read back from a project the API itself created, so the seeds land in
    // the SAME tenant the API key authenticates as - never a guessed id.
    probe = await createProject(`${SEED_NAME}_PROBE`);
    const probeDoc = await db.collection('projects').findOne({_id: probe.projectId},
      {projection: {companyId: 1}});
    companyId = probeDoc && probeDoc.companyId;
    expect(companyId).toBeTruthy();

    await db.collection('projects').insertMany([
      {_id: SEEDED_IDS[0], companyId, name: SEED_NAME,
        creationDate: new Date('2024-03-01T00:00:00Z')},
      {_id: SEEDED_IDS[1], companyId, name: SEED_NAME},
      {_id: SEEDED_IDS[2], companyId, name: SEED_NAME,
        creationDate: new Date('2024-01-01T00:00:00Z')},
      // Older than all three, and must never win: it belongs to another company.
      {_id: FOREIGN_ID, companyId: FOREIGN_COMPANY, name: SEED_NAME,
        creationDate: new Date('2000-01-01T00:00:00Z')}
    ]);
  });

  afterAll(async () => {
    // The residual assertion below is the point of the cleanup, but it must not be able to
    // SKIP the rest of it: an `expect` that throws here would leak the probe project and
    // leave the Mongo client open (which jest reports as a hanging handle, not as this
    // failure). Everything that has to happen regardless goes in the `finally`.
    try {
      if (db) {
        await db.collection('projects')
          .deleteMany({_id: {$in: [...SEEDED_IDS, FOREIGN_ID]}});
        const residual = await db.collection('projects')
          .countDocuments({_id: {$in: [...SEEDED_IDS, FOREIGN_ID]}});
        expect(residual).toEqual(0);
      }
    } finally {
      if (probe) { await removeProjectIfCreated(probe.projectId, probe.created); }
      if (client) { await client.close(); }
    }
  });

  it('answers 200 with the oldest duplicate and creates no fourth row', async () => {
    expect(await countOwn()).toEqual(3);

    const response = await supertest(ROOT_URL).post(PROJECTS_URL)
      .set('x-api-key', API_KEY).send({name: SEED_NAME})
      .expect(StatusCodes.OK);

    expect(response.body).toEqual({projectId: `${SEED_NAME}_undated`, existing: true});
    expect(await countOwn()).toEqual(3);
  });

  it('a scan naming it lands under that same project', async () => {
    const response = await supertest(ROOT_URL).post(`${BASE}/core/scans`)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .send({
        project: SEED_NAME,
        module: `${SEED_NAME}_MODULE`,
        moduleId: `${SEED_NAME}_MODULE`,
        demo: false,
        dependencies: [{name: 'lodash', key: 'npm:lodash', versions: ['4.17.21'],
          licenses: [{name: 'MIT'}], dependencies: []}]
      })
      .expect(StatusCodes.CREATED);

    const scan = await db.collection('scans').findOne({_id: response.body.scanId});
    expect(scan).toBeTruthy();
    const module = await db.collection('modules').findOne({_id: scan.moduleId});
    expect(module.projectId).toEqual(`${SEED_NAME}_undated`);

    // Everything this assertion created, removed by exact id.
    await db.collection('scans').deleteMany({_id: response.body.scanId});
    await db.collection('modules').deleteMany({_id: scan.moduleId});
    await db.collection('analysis').deleteMany({scanId: response.body.scanId});
  });

  it('leaves the other company\'s same-named project alone', async () => {
    const foreign = await db.collection('projects').findOne({_id: FOREIGN_ID});
    expect(foreign.companyId).toEqual(FOREIGN_COMPANY);
    expect(foreign.name).toEqual(SEED_NAME);
  });
});

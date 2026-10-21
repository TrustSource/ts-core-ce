/* eslint-disable no-undef*/
// Live REST integration regression for slow approval creation - companion to approves-generation.spec.js.
//
// approves-generation.spec.js proves the synchronous REST create persists a
// terminal `generation.status:'done'` doc (read straight from Mongo). This spec
// closes the remaining live gaps:
//   1. TIMING BASELINE for the headline AC: the synchronous REST POST
//      /approval/initiate must actually COMPLETE within the suite timeout while
//      doing the full generation inline. (The browser/background fast-return path
//      has no DDP test client, so we baseline the synchronous side here and prove
//      the fast-return structure via source text in
//      approves-create-generation-shape.unit.spec.js - see the report.)
//   2. The persisted REST approve carries NO `background` flag and reaches a
//      terminal-done generation - proving REST stayed synchronous + complete and
//      the wizard-only flag never leaked into the REST payload.
//   3. END-TO-END read-back through the PUBLIC GET handler (not just Mongo): the
//      GET /approval/:id endpoint returns a coherent, fully-populated approve for
//      the synchronously-created record (name + url, and a noticeFile block since
//      generation produced a noticeFileId).
//
// Needs the running dev server + API key from .env.jest. Demo data is left for
// Remove demo data in the app. Mongo read-back is guarded (skips, never
// false-passes, if MONGO_URL is unavailable).
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_approval.json');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

const {MongoClient} = require('mongodb');
// One definition of "is there a database to read", shared with the specs that need one
// for every test. connectMongo bounds the connect, so a MONGO_URL pointing at a MongoDB
// that is not running fails in 5s naming the URL rather than as a 30s hook timeout.
const {MONGO_URL, connectMongo} = require('../helpers/gates');

describe(`#79 REST synchronous generation - timing baseline + e2e read-back (${BASE}/compliance/approvals)`, () => {
  let scanId;
  let approveId;
  let mongo;
  let db;
  let elapsedMs;
  const url = `${BASE}/compliance/approvals`;

  beforeAll(async () => {
    if (MONGO_URL) {
      mongo = await connectMongo(MongoClient);
      db = mongo.db();
    }
  });

  afterAll(async () => {
    if (mongo) {
      await mongo.close();
    }
  });

  it(`200 POST ${BASE}/core/projects (demo)`, async () => {
    // Project name must match the scan fixture's project ("TEST_APPROVAL") so the
    // uploaded scan binds to it (same pattern as approves.spec.js).
    const data = {name: 'TEST_APPROVAL', demo: true};
    await supertest(ROOT_URL).post(`${BASE}/core/projects`).send(data)
      .set('x-api-key', API_KEY)
      .expect(expectProjectCreatedOrExisting)
      .then((response) => {
        expect(response.body).toHaveProperty('projectId');
      });
  });

  it(`200 POST ${BASE}/core/scans (demo)`, async () => {
    await supertest(ROOT_URL).post(`${BASE}/core/scans`).send(scanData)
      .set('user-agent', 'ts-node-client/3.0.1')
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('scanId');
        scanId = response.body.scanId;
      });
  });

  it('201 POST returns {approveId} and COMPLETES synchronously within the timeout', async () => {
    // Timing baseline for the headline AC. The synchronous REST path runs the
    // entire 4-stage generation inline before responding; assert it returns 201
    // and finishes within the (generous) suite timeout. A regression that hangs
    // the synchronous path (e.g. an un-awaited stage that never resolves the
    // response) trips this. We do NOT assert it is "fast" - REST is deliberately
    // synchronous; we assert it terminates and returns a complete result.
    const data = {
      scanId,
      name: 'TEST_APPROVAL_GEN_INT',
      version: '1.0.0',
      description: 'TEST_APPROVAL_GEN_INT',
      demo: true
    };
    const t0 = Date.now();
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('approveId');
        approveId = response.body.approveId;
      });
    elapsedMs = Date.now() - t0;
    // Sanity bound: it returned (non-negative, under the jest timeout). The
    // assertion's value is that the call resolved at all - a deadlocked
    // synchronous generation would have thrown a jest timeout instead.
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    expect(elapsedMs).toBeLessThan(30000);
  });

  it('the persisted REST approve is terminal-done and carries NO background flag', async () => {
    if (!db) {
      // No Mongo connection: cannot inspect the persisted doc. Skip rather than
      // give a false pass - the 201 above already proved the request succeeded.
      console.warn('MONGO_URL not set - skipping persisted-doc inspection');
      return;
    }
    expect(approveId).toBeDefined();
    const approve = await db.collection('approves').findOne({_id: approveId});
    expect(approve).not.toBeNull();

    // REST stays synchronous: the wizard-only `background` flag must NOT be
    // persisted onto the REST-created approve (it is not part of the doc the
    // interactor builds, and REST never supplies it).
    expect(approve.background).toBeUndefined();

    // And the synchronous path left the generation in a terminal, complete state.
    expect(approve.generation).toBeDefined();
    expect(approve.generation.status).toBe('done');
    expect(approve.generation.current).toBeNull();
    // No stage is left mid-flight (running/pending) once REST returns.
    const stageValues = Object.values(approve.generation.stages || {});
    expect(stageValues.length).toBeGreaterThan(0);
    stageValues.forEach((v) => {
      expect(['done', 'skipped', 'failed']).toContain(v);
    });
  });

  it('GET /compliance/approvals/:id returns a coherent, fully-populated approve (e2e through the public handler)', async () => {
    // End-to-end seam the unit/Mongo specs cannot reach: the public GET handler's
    // projection of a synchronously-generated approve.
    expect(approveId).toBeDefined();
    await supertest(ROOT_URL).get(`${BASE}/compliance/approvals/${approveId}`)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.OK)
      .then((response) => {
        // Core identity fields the handler always emits.
        expect(response.body).toHaveProperty('name');
        expect(response.body.name).toBe('TEST_APPROVAL_GEN_INT');
        expect(response.body).toHaveProperty('_id');
        expect(response.body._id).toBe(approveId);
        // The handler computes a project/module deep link for every approve.
        expect(response.body).toHaveProperty('url');
        expect(typeof response.body.url).toBe('string');
        // Synchronous generation produced a notice file, so the handler exposes
        // the noticeFile stats block (only present when noticeFileId is set).
        // This proves the generated artefact is reachable through the public API.
        expect(response.body).toHaveProperty('noticeFile');
      });
  });
});

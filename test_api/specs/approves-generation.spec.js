/* eslint-disable no-undef*/
// Live REST integration regression for slow approval creation.
//
// USER DECISION (binding): the REST path stays SYNCHRONOUS - POST
// /approval/initiate must keep blocking until full generation and return
// 201 {approveId} with a COMPLETE approve. The fast-return + background
// generation behaviour applies ONLY to the browser wizard + create-from-draft
// paths (which pass background:true; REST omits the flag).
//
// This spec creates a demo project + scan (the approves.spec.js pattern),
// POSTs /approval/initiate WITHOUT a background flag, and asserts the resulting
// approve is fully generated synchronously: generation.status === 'done' and the
// backing artefacts (noticeFileId / sbomFileId / stats) are present on return.
//
// Needs the running dev server + API key from .env.jest. Demo data is left for
// Remove demo data in the app; this spec only reads back the approve it
// just created.
const supertest = require('supertest');
const StatusCodes = require('http-status-codes');
const {expectProjectCreatedOrExisting} = require('../helpers/projectFixtures');
const scanData = require('../response/scan_approval.json');
const ROOT_URL = process.env.ROOT_URL;
const BASE = process.env.BASE;
const API_KEY = process.env.API_KEY;

// MONGO_URL lets us read the full approve doc back (the public GET projection
// does not expose `generation` / stats). Same approach releases.spec.js uses.
const {MongoClient} = require('mongodb');
// One definition of "is there a database to read", shared with the specs that need one
// for every test. connectMongo bounds the connect, so a MONGO_URL pointing at a MongoDB
// that is not running fails in 5s naming the URL rather than as a 30s hook timeout.
const {MONGO_URL, connectMongo} = require('../helpers/gates');

describe(`#79 REST stays synchronous - POST ${BASE}/compliance/approvals generates a COMPLETE approve`, () => {
  let scanId;
  let approveId;
  let mongo;
  let db;
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
    // The scan fixture references project/module "TEST_APPROVAL"; the project
    // name must match so the scan upload binds to it (same as approves.spec.js).
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

  it(`201 POST ${url} returns {approveId} (no background flag)`, async () => {
    const data = {
      scanId,
      name: 'TEST_APPROVAL_GEN',
      version: '1.0.0',
      description: 'TEST_APPROVAL_GEN',
      demo: true
    };
    await supertest(ROOT_URL).post(url).send(data)
      .set('x-api-key', API_KEY)
      .expect(StatusCodes.CREATED)
      .then((response) => {
        expect(response.body).toHaveProperty('approveId');
        approveId = response.body.approveId;
      });
  });

  it('the approve is fully generated SYNCHRONOUSLY on return (generation.status done + artefacts present)', async () => {
    if (!db) {
      // Without a Mongo connection we cannot inspect the full doc; skip rather
      // than give a false pass. The other assertions already prove 201.
      console.warn('MONGO_URL not set - skipping synchronous-completeness assertion');
      return;
    }
    expect(approveId).toBeDefined();
    const approve = await db.collection('approves').findOne({_id: approveId});
    expect(approve).not.toBeNull();

    // Contract: generation must be a terminal 'done' state the moment REST returns.
    expect(approve.generation).toBeDefined();
    expect(approve.generation.status).toBe('done');
    expect(approve.generation.current).toBeNull();
    expect(approve.generation.finishedAt).toBeTruthy();

    // Every stage finished.
    const stages = approve.generation.stages;
    expect(stages.report).toBe('done');
    expect(stages.notice).toBe('done');
    expect(stages.sbom).toBe('done');

    // Backing artefacts were produced synchronously (proves REST did NOT
    // fast-return before generation).
    expect(approve.noticeFileId).toBeTruthy();
    expect(approve.sbomFileId).toBeTruthy();
    expect(approve.stats).toBeDefined();
  });
});

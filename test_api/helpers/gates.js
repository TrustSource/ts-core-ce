// Gating a describe() block on something the environment may not have: a sibling
// repository checkout, or a MongoDB the running app writes to.
//
// ── WHY describe.skip IS NOT ENOUGH ────────────────────────────────────────────────
// Jest EXECUTES the callback of a skipped describe. It has to - that is how it learns
// the names of the tests it is about to report as skipped - and only the `it` bodies
// inside are left unrun. So a block written as
//
//   const describeUpstream = fs.existsSync(UPSTREAM) ? describe : describe.skip;
//   describeUpstream('...', () => {
//     const {thing} = require(UPSTREAM);   // <- runs even when skipped
//
// throws MODULE_NOT_FOUND at collection time on any machine without the dependency,
// and Jest reports "Test suite failed to run" for the WHOLE file - taking the in-repo
// half of that spec, the half that is supposed to always run, down with it. Three psirt
// specs did exactly that on CI while passing locally.
//
// The gates below return a describe that genuinely does not call its callback. One
// placeholder test stands in, so the reason still appears in the report as a skip
// rather than vanishing.
// ───────────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

/** <workspace>/ts-app/test_api/helpers -> <workspace> */
const WORKSPACE = path.join(__dirname, '../../..');

/** An absolute path inside a sibling checkout, e.g. upstreamPath('ts-psirt', 'package.json'). */
function upstreamPath(repo, relative) {
  return path.join(WORKSPACE, repo, relative);
}

/**
 * A stand-in describe that reports the block as skipped and never runs its callback.
 * Everything that makes the block unrunnable lives inside that callback, so dropping it
 * is the point rather than an omission.
 */
function skippingDescribe(reason) {
  return function skipped(name) {
    describe.skip(name, () => {
      it('skipped - ' + reason, () => {});
    });
  };
}

/**
 * A `describe` for a block that reads from another repository.
 *
 * @param {string[]} requiredPaths absolute paths that must all exist
 * @param {string} reason what is missing, named in the placeholder test
 * @returns {Function} describe, or a describe that never runs its callback
 */
function describeWithUpstream(requiredPaths, reason) {
  if (requiredPaths.every((p) => fs.existsSync(p))) return describe;
  return skippingDescribe(reason);
}

// ── THE MONGO GATE ─────────────────────────────────────────────────────────────────
// Some specs assert on the database directly, because the REST response alone cannot
// show what was persisted - that no duplicate component version was created, that an
// imported crypto asset landed module-scoped, that a plaintext API key still resolves.
//
// Those specs can only run where the app under test and its MongoDB are on the same
// machine, which means a developer's `meteor` checkout. On CI the app under test is the
// deployed develop environment, whose database the runner cannot reach - and a local
// MongoDB would not help, because that is not the database the deployed app writes to.
//
// They used to default MONGO_URL to mongodb://127.0.0.1:3001, so on CI each one sat
// through the driver's 30s server-selection timeout and then failed as a hook timeout
// naming nothing - five suites red and about five minutes of the run spent waiting for
// a connection that could never succeed. Requiring MONGO_URL to be set explicitly is
// the convention approves-generation.spec.js already used, and it makes CI skip them in
// milliseconds while a developer with it in .env.jest sees no change.
// ───────────────────────────────────────────────────────────────────────────────────

/** The database to inspect, or null when this environment has none. */
const MONGO_URL = process.env.MONGO_URL || null;

/**
 * How long to wait for a MongoDB that was explicitly configured. Well under the 30s
 * Jest hook timeout, so an unreachable one is reported as what it is - a connection
 * that failed, naming the URL - instead of as a hook that ran out of time naming the
 * line number of a beforeAll.
 */
const SERVER_SELECTION_TIMEOUT_MS = 5000;

/** A `describe` for a block that has to read the app's database. */
function describeWithMongo() {
  if (MONGO_URL) return describe;
  return skippingDescribe(
    'needs the app database - set MONGO_URL to run this against a local meteor checkout'
  );
}

/**
 * A connected client, with a bounded connect and an error that says what to do.
 *
 * @param {object} MongoClient the driver class, passed in so this helper stays free of
 *   a hard dependency on the driver for the specs that never touch Mongo
 */
async function connectMongo(MongoClient) {
  const client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      'MONGO_URL is set to ' + MONGO_URL + ' but no MongoDB answered within ' +
      SERVER_SELECTION_TIMEOUT_MS + 'ms - start the local meteor app, or unset MONGO_URL ' +
      'to skip the specs that inspect the database. Cause: ' + error.message
    );
  }
  return client;
}

module.exports = {
  WORKSPACE,
  upstreamPath,
  skippingDescribe,
  describeWithUpstream,
  MONGO_URL,
  SERVER_SELECTION_TIMEOUT_MS,
  describeWithMongo,
  connectMongo
};

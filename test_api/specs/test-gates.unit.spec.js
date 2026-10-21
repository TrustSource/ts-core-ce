/* eslint-disable no-undef */
// The gates that let a spec depend on something the environment may not have - a
// sibling repository checkout, or the app's MongoDB - without failing where it is
// absent: CI, a fresh clone, anybody who only has ts-app.
//
// This exists because the obvious spelling is wrong in a way nothing catches until it
// runs somewhere else. `describe.skip` EXECUTES its callback - it has to, to learn the
// names of the tests it is about to report as skipped - so a require() or readFileSync
// at the top of the block throws even when the block is skipped, and Jest fails the
// WHOLE FILE with "Test suite failed to run", taking the in-repo half of that spec with
// it. Three psirt specs did exactly that on CI while passing locally.
//
// So the property under test is not "does it skip" but "does the callback never run".
const path = require('path');
const {
  WORKSPACE, upstreamPath, describeWithUpstream, skippingDescribe, describeWithMongo, MONGO_URL
} = require('../helpers/gates');

const PRESENT = path.join(__dirname, 'test-gates.unit.spec.js');
const ABSENT = path.join(__dirname, 'no-such-sibling-repo-file.ts');

// ── EXERCISED AT MODULE SCOPE, WHICH IS WHERE THE GATE IS USED ─────────────────────
// A describe() cannot be registered from inside a running test, and collection time is
// exactly when the defect fires, so the calls happen here and the assertions below only
// read what they recorded.
const absentGate = describeWithUpstream([ABSENT], 'a sibling checkout this spec invents');

let calledBack = false;
absentGate('a block that must not be entered', () => { calledBack = true; });

let threw = null;
try {
  absentGate('a block that would throw', () => { require('/definitely/not/a/module'); });
} catch (error) {
  threw = error;
}

describe('describeWithUpstream', () => {
  it('is describe itself when every required path exists', () => {
    expect(describeWithUpstream([PRESENT], 'reason')).toBe(describe);
    expect(describeWithUpstream([PRESENT, PRESENT], 'reason')).toBe(describe);
  });

  it('is NOT describe when a required path is missing', () => {
    expect(describeWithUpstream([ABSENT], 'reason')).not.toBe(describe);
    // One present and one absent is still absent - a partial checkout is not a checkout.
    expect(describeWithUpstream([PRESENT, ABSENT], 'reason')).not.toBe(describe);
  });

  // THE regression. If this ever fails, every cross-repo spec goes back to failing to
  // run on a machine without the sibling checkout.
  it('never runs the callback when the dependency is absent', () => {
    expect(calledBack).toBe(false);
  });

  // The failure mode it replaces: a throwing body took the whole file down with it.
  it('survives a callback that would throw', () => {
    expect(threw).toBeNull();
  });
});

describe('upstreamPath', () => {
  it('resolves beside the ts-app checkout, not inside it', () => {
    expect(upstreamPath('ts-psirt', 'packages/shared/dist/index.js'))
      .toBe(path.join(WORKSPACE, 'ts-psirt/packages/shared/dist/index.js'));
    // <workspace>/ts-app/test_api/helpers -> <workspace>: the sibling is one level
    // above this repository, never under it.
    expect(path.join(WORKSPACE, 'ts-app')).toBe(path.join(__dirname, '../..'));
  });
});

// ── THE MONGO GATE ─────────────────────────────────────────────────────────────────
// Same primitive, same regression: a spec that inspects the app database used to
// default MONGO_URL to a local port, so on CI it sat through the driver's 30s
// server-selection timeout and failed as a hook timeout naming nothing.
let mongoBlockEntered = false;
describeWithMongo()('a mongo-gated block', () => { mongoBlockEntered = true; });

describe('describeWithMongo', () => {
  it('runs the block only where a database was configured', () => {
    // Whichever way this environment is set up, the gate and the block agree - which is
    // the property that failed before: the block ran with no database behind it.
    expect(mongoBlockEntered).toBe(!!MONGO_URL);
    expect(describeWithMongo() === describe).toBe(!!MONGO_URL);
  });

  it('never defaults to a local port nobody configured', () => {
    // The default was mongodb://127.0.0.1:3001. MONGO_URL is now null unless somebody
    // set it, which is what lets CI skip in milliseconds instead of timing out.
    expect(MONGO_URL).toBe(process.env.MONGO_URL || null);
  });
});

describe('skippingDescribe', () => {
  it('reports a skip without running anything', () => {
    // Asserted through the two gates above rather than by calling it here: registering a
    // describe from inside a running test is not allowed, which is precisely why both
    // gates have to make their decision at collection time.
    expect(typeof skippingDescribe('reason')).toBe('function');
  });
});

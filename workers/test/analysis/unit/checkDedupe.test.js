import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Utils } from '../../../analysis/services/Utils.js';

// rebuildModuleObject emits one entry per component:version:path, so a component reached
// from 800 places is asked about 800 times. The legal check answers identically for every
// entry that carries the same licenses/modified/tightCoupled, and each answer costs a z3
// solve, so only the distinct ones are sent and the answer is spread back afterwards.

const entry = (licenses, modified = true, tightCoupled = true) => ({ licenses, modified, tightCoupled });

describe('Utils.dedupeCheckComponents', () => {
  it('sends one entry per distinct license/modified/tightCoupled combination', () => {
    const { components, groups } = Utils.dedupeCheckComponents({
      'a:1.0:0': entry(['Apache-2.0']),
      'a:1.0:1': entry(['Apache-2.0']),
      'b:2.0:0': entry(['Apache-2.0']),
      'c:3.0:0': entry(['MIT'])
    });
    assert.equal(Object.keys(components).length, 2);
    assert.equal(Object.keys(groups).length, 2);
    // every original key is still accounted for
    const covered = Object.values(groups).flat().sort();
    assert.deepEqual(covered, ['a:1.0:0', 'a:1.0:1', 'b:2.0:0', 'c:3.0:0']);
  });

  it('treats the same licenses in a different order as one entry', () => {
    const { components } = Utils.dedupeCheckComponents({
      'a:1.0:0': entry(['MIT', 'Apache-2.0']),
      'b:1.0:0': entry(['Apache-2.0', 'MIT'])
    });
    assert.equal(Object.keys(components).length, 1);
  });

  it('keeps entries apart when modified or tightCoupled differ', () => {
    const { components } = Utils.dedupeCheckComponents({
      'a:1.0:0': entry(['MIT'], true, true),
      'b:1.0:0': entry(['MIT'], false, true),
      'c:1.0:0': entry(['MIT'], true, false),
      'd:1.0:0': entry(['MIT'], false, false)
    });
    assert.equal(Object.keys(components).length, 4);
  });

  it('sends the entry unchanged, licenses in their original order', () => {
    const original = entry(['MIT', 'Apache-2.0']);
    const { components } = Utils.dedupeCheckComponents({ 'a:1.0:0': original });
    assert.deepEqual(components['a:1.0:0'], original);
    assert.deepEqual(components['a:1.0:0'].licenses, ['MIT', 'Apache-2.0']);
  });

  it('keeps a component with no licenses as its own single entry', () => {
    const { components, groups } = Utils.dedupeCheckComponents({
      'a:1.0:0': entry([]),
      'b:1.0:0': entry([]),
      'c:1.0:0': entry(['MIT'])
    });
    assert.equal(Object.keys(components).length, 2);
    assert.equal(Object.values(groups).flat().length, 3);
  });

  it('survives an empty or absent components map', () => {
    for (const input of [undefined, null, {}]) {
      const { components, groups } = Utils.dedupeCheckComponents(input);
      assert.deepEqual(components, {});
      assert.deepEqual(groups, {});
    }
  });
});

describe('Utils.expandCheckResult', () => {
  it('spreads the representative answer over every key it stood for', () => {
    const groups = { 'a:1.0:0': ['a:1.0:0', 'a:1.0:1', 'b:2.0:0'] };
    const answers = { 'a:1.0:0': { 'Apache-2.0': { status: 'SAT', obligations: ['o1'], rules: [] } } };
    const out = Utils.expandCheckResult(answers, groups);
    assert.deepEqual(Object.keys(out).sort(), ['a:1.0:0', 'a:1.0:1', 'b:2.0:0']);
    for (const key of Object.keys(out)) {
      assert.equal(out[key]['Apache-2.0'].status, 'SAT');
      assert.deepEqual(out[key]['Apache-2.0'].obligations, ['o1']);
    }
  });

  // normalizeLicenseStatus rewrites obligations/rules ON the object it is handed, and what
  // it strips depends on the component key. Sharing one object across keys would let the
  // first component's resolution rewrite every other component's answer.
  it('gives every key its own copy, so a later mutation cannot leak', () => {
    const groups = { 'a:1.0:0': ['a:1.0:0', 'a:1.0:1'] };
    const answers = { 'a:1.0:0': { MIT: { status: 'UNSAT', obligations: ['keep'], rules: ['r1'] } } };
    const out = Utils.expandCheckResult(answers, groups);

    assert.notEqual(out['a:1.0:0'], out['a:1.0:1']);
    assert.notEqual(out['a:1.0:0'].MIT, out['a:1.0:1'].MIT);
    assert.notEqual(out['a:1.0:0'].MIT.obligations, out['a:1.0:1'].MIT.obligations);

    out['a:1.0:0'].MIT.obligations = [];
    out['a:1.0:0'].MIT.rules = [];
    assert.deepEqual(out['a:1.0:1'].MIT.obligations, ['keep']);
    assert.deepEqual(out['a:1.0:1'].MIT.rules, ['r1']);
  });

  it('leaves a key unanswered when the check answered nothing for its representative', () => {
    const groups = { 'a:1.0:0': ['a:1.0:0', 'a:1.0:1'] };
    const out = Utils.expandCheckResult({}, groups);
    assert.equal(out['a:1.0:0'], undefined);
    assert.equal(out['a:1.0:1'], undefined);
  });

  it('passes an empty answer through as an empty answer', () => {
    const groups = { 'a:1.0:0': ['a:1.0:0', 'a:1.0:1'] };
    const out = Utils.expandCheckResult({ 'a:1.0:0': {} }, groups);
    assert.deepEqual(out['a:1.0:0'], {});
    assert.deepEqual(out['a:1.0:1'], {});
  });

  it('survives an absent answer map', () => {
    assert.deepEqual(Utils.expandCheckResult(null, { 'a:1.0:0': ['a:1.0:0'] }), { 'a:1.0:0': undefined });
    assert.deepEqual(Utils.expandCheckResult({}, {}), {});
  });
});

describe('dedupe then expand, round trip', () => {
  it('reproduces exactly the key space rebuildModuleObject asked about', () => {
    const built = {};
    // 200 paths of one Apache component, 50 of an MIT one, 1 unlicensed
    for (let i = 0; i < 200; i++) built['apache:1.0:' + i] = entry(['Apache-2.0']);
    for (let i = 0; i < 50; i++) built['mit:2.0:' + i] = entry(['MIT']);
    built['none:3.0:0'] = entry([]);

    const { components, groups } = Utils.dedupeCheckComponents(built);
    assert.equal(Object.keys(built).length, 251);
    assert.equal(Object.keys(components).length, 3, 'only three distinct problems to solve');

    // answer the way the legal check does: per asked key, per license
    const answers = {};
    for (const [key, e] of Object.entries(components)) {
      answers[key] = {};
      for (const lic of e.licenses) answers[key][lic] = { status: 'SAT', obligations: [], rules: [] };
    }

    const out = Utils.expandCheckResult(answers, groups);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(built).sort());
    assert.equal(out['apache:1.0:199']['Apache-2.0'].status, 'SAT');
    assert.equal(out['mit:2.0:49'].MIT.status, 'SAT');
    assert.deepEqual(out['none:3.0:0'], {});
  });
});

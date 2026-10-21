/* eslint-disable no-undef*/
// The seven riskProperties.* fields the importer owns are
// server-managed, and `denyUpdate: true` is a NO-OP in this repo's vendored
// simple-schema. So immutability has to be executable code, and this is it.
//
// If a client could set `riskProperties.autoKey`, it could point an auto-managed
// Risk at another module's identity, adopt one, or - by clearing it - make the
// next import mint a duplicate. If it could set `sourceRefs`, the risk register
// would carry evidence no scan ever produced.
//
// Pure CommonJS, so Jest requires it directly.
const {
  MANAGED_RISK_FIELDS,
  MANAGED_RISK_PROPERTY_KEYS,
  UNTOUCHED_RISK_STATES,
  touchesRiskPropertiesWholesale,
  stripManagedRiskFields,
  stripManagedRiskProperties
} = require('../../imports/lib/interactors/riskProperties/managedFields');

const STORED = {
  state: 'identified',
  origin: ['CWE'],
  autoKey: 'sarif-cwe|aaaaaaaaaaaaaaaaa|semgrep|CWE-79',
  autoTool: 'semgrep',
  autoCwe: 'CWE-79',
  sourceRefs: [{tool: 'semgrep', ruleId: 'xss', uri: 'a.js', level: 'error', count: 2}],
  sourceRefsTotal: 1,
  sourceRefsTruncated: false,
  sourceRefsPrevCount: 5
};

describe('#129 the managed field list', () => {
  it('is exactly the fields the server writes, dotted', () => {
    // Seven from the SARIF importer, plus `autoLicense` from the manual
    // license resolution - which is protected here for the same reason:
    // a client that could forge or clear it would make the next resolution
    // believe the risk already records the license it is about to store.
    expect(MANAGED_RISK_PROPERTY_KEYS).toEqual(['autoKey', 'autoTool', 'autoCwe', 'autoLicense',
      'sourceRefs', 'sourceRefsTotal', 'sourceRefsTruncated', 'sourceRefsPrevCount']);
    expect(MANAGED_RISK_FIELDS).toEqual(MANAGED_RISK_PROPERTY_KEYS
      .map((key) => 'riskProperties.' + key));
  });

  it('protects riskProperties.autoLicense on every modifier shape (#139)', () => {
    // Non-vacuity for the list above: the entry has to actually reach the
    // stripper, not just sit in an array.
    expect(stripManagedRiskFields({$set: {
      name: 'Renamed by a human',
      'riskProperties.autoLicense': 'GPL-3.0-only'
    }}, STORED)).toEqual({$set: {name: 'Renamed by a human'}});
    expect(stripManagedRiskFields({$unset: {'riskProperties.autoLicense': ''}}, STORED))
      .toEqual({});
    expect(stripManagedRiskFields({$rename: {'riskProperties.autoLicense': 'x'}}, STORED))
      .toEqual({});
  });

  it('names the four states an import must not write to', () => {
    // The issue's four, deliberately NOT RESOLVED_RISK_STATES: `eliminated`,
    // `deferred` and `expired` still get their evidence refreshed (AC27).
    expect(UNTOUCHED_RISK_STATES).toEqual(['accepted', 'transferred', 'out-of-scope', 'closed']);
    ['eliminated', 'deferred', 'expired', 'identified'].forEach((state) => {
      expect(UNTOUCHED_RISK_STATES.indexOf(state)).toEqual(-1);
    });
  });
});

describe('#129 stripManagedRiskFields - dotted paths', () => {
  it('removes every managed path from $set and keeps everything else', () => {
    const modifier = {$set: {
      name: 'Renamed by a human',
      'riskProperties.state': 'accepted',
      'riskProperties.origin': ['CWE', 'SQ'],
      'riskProperties.autoKey': 'sarif-cwe|other|semgrep|CWE-79',
      'riskProperties.autoTool': 'codeql',
      'riskProperties.autoCwe': 'CWE-89',
      'riskProperties.sourceRefs': [{tool: 'x'}],
      'riskProperties.sourceRefsTotal': 999,
      'riskProperties.sourceRefsTruncated': true,
      'riskProperties.sourceRefsPrevCount': 0
    }};
    expect(stripManagedRiskFields(modifier, STORED)).toEqual({$set: {
      name: 'Renamed by a human',
      'riskProperties.state': 'accepted',
      'riskProperties.origin': ['CWE', 'SQ']
    }});
  });

  it('does not mutate the modifier it is handed', () => {
    const modifier = {$set: {'riskProperties.autoKey': 'x', name: 'n'}};
    stripManagedRiskFields(modifier, null);
    expect(modifier.$set['riskProperties.autoKey']).toEqual('x');
  });

  it('removes managed paths from $unset, $inc, $push, $pull and $addToSet alike', () => {
    expect(stripManagedRiskFields({
      $unset: {'riskProperties.autoKey': '', 'riskProperties.impact': ''},
      $inc: {'riskProperties.sourceRefsTotal': 1},
      $push: {'riskProperties.sourceRefs': {tool: 'evil'},
        'riskProperties.countermeasures': {countermeasure: 'patch'}},
      $pull: {'riskProperties.sourceRefs': {uri: 'a.js'}},
      $addToSet: {'riskProperties.sourceRefs': {tool: 'evil'}}
    }, STORED)).toEqual({
      $unset: {'riskProperties.impact': ''},
      $push: {'riskProperties.countermeasures': {countermeasure: 'patch'}}
    });
  });

  it('removes a sub-path INTO a managed array or object', () => {
    // `riskProperties.sourceRefs.0.count` and the positional form are writes to
    // a managed field however they are spelled.
    expect(stripManagedRiskFields({$set: {
      'riskProperties.sourceRefs.0.count': 4000,
      'riskProperties.sourceRefs.$.uri': 'other.js',
      'riskProperties.autoKey.nested': 'x',
      'riskProperties.impactDescription': 'kept'
    }}, STORED)).toEqual({$set: {'riskProperties.impactDescription': 'kept'}});
  });

  it('blocks a $rename on either end', () => {
    expect(stripManagedRiskFields({$rename: {
      'riskProperties.autoKey': 'riskProperties.impact',
      'riskProperties.impact': 'riskProperties.autoKey',
      'riskProperties.impact2': 'riskProperties.impact3'
    }}, STORED)).toEqual({$rename: {'riskProperties.impact2': 'riskProperties.impact3'}});
  });

  it('drops an operator whose payload becomes empty rather than sending Mongo an empty one', () => {
    expect(stripManagedRiskFields({$unset: {'riskProperties.autoKey': ''}}, STORED)).toEqual({});
  });

  it('leaves a modifier with nothing managed in it completely alone', () => {
    const modifier = {$set: {name: 'n', 'riskProperties.state': 'closed'},
      $unset: {'riskProperties.impact': ''}};
    expect(stripManagedRiskFields(modifier, STORED)).toEqual(modifier);
  });

  it('returns non-object modifiers untouched', () => {
    [null, undefined, 'nope', 42].forEach((value) => {
      expect(stripManagedRiskFields(value, STORED)).toEqual(value);
    });
  });
});

describe('#129 stripManagedRiskFields - a wholesale riskProperties write', () => {
  const WHOLESALE = {$set: {riskProperties: {
    state: 'accepted',
    impact: 'high',
    autoKey: 'sarif-cwe|someone-elses-module|semgrep|CWE-79',
    autoTool: 'codeql',
    autoCwe: 'CWE-89',
    sourceRefs: [{tool: 'forged', ruleId: 'r', uri: 'u', level: 'error', count: 1}],
    sourceRefsTotal: 1,
    sourceRefsTruncated: true,
    sourceRefsPrevCount: 0
  }}};

  it('is recognised as needing the stored document', () => {
    expect(touchesRiskPropertiesWholesale(WHOLESALE)).toBe(true);
    expect(touchesRiskPropertiesWholesale({$unset: {riskProperties: ''}})).toBe(true);
    expect(touchesRiskPropertiesWholesale({$set: {'riskProperties.state': 'closed'}})).toBe(false);
    expect(touchesRiskPropertiesWholesale({$set: {name: 'n'}})).toBe(false);
    expect(touchesRiskPropertiesWholesale(null)).toBe(false);
  });

  it('REPLACES the managed keys from the stored document instead of dropping them', () => {
    // Dropping them would be worse than letting them through: a $set of the whole
    // subdocument replaces it, so an omitted autoKey means the Risk loses its
    // identity and the next import mints a duplicate.
    const out = stripManagedRiskFields(WHOLESALE, STORED);
    expect(out.$set.riskProperties.state).toEqual('accepted');
    expect(out.$set.riskProperties.impact).toEqual('high');
    expect(out.$set.riskProperties.autoKey).toEqual(STORED.autoKey);
    expect(out.$set.riskProperties.autoTool).toEqual('semgrep');
    expect(out.$set.riskProperties.autoCwe).toEqual('CWE-79');
    expect(out.$set.riskProperties.sourceRefs).toEqual(STORED.sourceRefs);
    expect(out.$set.riskProperties.sourceRefsTotal).toEqual(1);
    expect(out.$set.riskProperties.sourceRefsTruncated).toBe(false);
    expect(out.$set.riskProperties.sourceRefsPrevCount).toEqual(5);
  });

  it('does not mutate the stored document it copies from', () => {
    const out = stripManagedRiskFields(WHOLESALE, STORED);
    out.$set.riskProperties.sourceRefs.push({tool: 'x'});
    expect(STORED.sourceRefs.length).toEqual(1);
  });

  it('simply removes the managed keys when the Risk is not auto-managed', () => {
    const out = stripManagedRiskFields(WHOLESALE, {state: 'identified', impact: 'low'});
    MANAGED_RISK_PROPERTY_KEYS.forEach((key) => {
      expect(Object.prototype.hasOwnProperty.call(out.$set.riskProperties, key)).toBe(false);
    });
    expect(out.$set.riskProperties.state).toEqual('accepted');
  });

  it('handles a missing stored document', () => {
    [null, undefined].forEach((stored) => {
      const out = stripManagedRiskFields(WHOLESALE, stored);
      expect(out.$set.riskProperties.autoKey).toBeUndefined();
      expect(out.$set.riskProperties.state).toEqual('accepted');
    });
  });

  it('drops a $unset of the whole subdocument, which would delete the identity', () => {
    expect(stripManagedRiskFields({$unset: {riskProperties: '', name: ''}}, STORED))
      .toEqual({$unset: {name: ''}});
  });

  it('cleans a bare replacement-document field too', () => {
    const out = stripManagedRiskFields({riskProperties: {state: 'closed', autoKey: 'forged'}}, STORED);
    expect(out.riskProperties.autoKey).toEqual(STORED.autoKey);
    expect(out.riskProperties.state).toEqual('closed');
  });
});

describe('#129 stripManagedRiskProperties - RiskProperties.Create cannot plant an identity', () => {
  it('removes every managed key from a create payload', () => {
    const out = stripManagedRiskProperties({
      state: 'identified',
      origin: ['CWE'],
      autoKey: 'sarif-cwe|aaaaaaaaaaaaaaaaa|semgrep|CWE-79',
      autoTool: 'semgrep',
      autoCwe: 'CWE-79',
      sourceRefs: [{tool: 'forged'}],
      sourceRefsTotal: 1,
      sourceRefsTruncated: true,
      sourceRefsPrevCount: 2
    });
    expect(out).toEqual({state: 'identified', origin: ['CWE']});
  });

  it('does not mutate its argument', () => {
    const params = {state: 'identified', autoKey: 'x'};
    stripManagedRiskProperties(params);
    expect(params.autoKey).toEqual('x');
  });

  // Previously this passed a non-object straight back. An ARRAY is the shape
  // that made that a hole: `[{autoKey: 'sarif-cwe|<victim>|semgrep|CWE-79'}]` has
  // no keys the stripper recognizes as managed, so it went through untouched and
  // was stopped only by the vendored simple-schema rejecting an array for an
  // object-typed field - the same package whose `denyUpdate` silently does
  // nothing. Dropping it explicitly is the enforcement not depending on that.
  it('drops a non-object payload outright rather than passing it through', () => {
    [null, undefined, 'nope', 42, true].forEach((value) => {
      expect(stripManagedRiskProperties(value)).toBeUndefined();
    });
  });

  it('drops an ARRAY carrying a forged autoKey', () => {
    expect(stripManagedRiskProperties([{autoKey: 'sarif-cwe|victim|semgrep|CWE-79'}]))
      .toBeUndefined();
  });

  // JSON.parse - which is what both DDP and the REST body parser produce - makes
  // an OWN `__proto__` key, and `out[key] = value` on one runs Object.prototype's
  // setter instead of storing anything.
  it('stores an own __proto__ key as data instead of hitting the prototype setter', () => {
    const forged = JSON.parse('{"state":"identified","__proto__":{"polluted":true}}');
    const out = stripManagedRiskProperties(forged);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect(out.state).toEqual('identified');
  });
});

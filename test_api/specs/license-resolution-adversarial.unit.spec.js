/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The three attacker-controlled strings, against the pure modules.
//
// `componentKey`, `license` and `justification` arrive over DDP from a browser.
// Two of them are ALSO scanner content: a component key comes out of an uploaded
// scan and a license key can be anything a company typed into `privateLicenses`
// (privateLicenses.create never checks a key against SPDX). They travel through
// four pure modules before anything is written:
//
//   resolutionEntry.js       - validates them and builds the stored entry
//   licenseResolution.js     - the client's copy of the same decisions
//   componentLicensePick.js  - puts the license into a stored scan
//   licenseRiskPlan.js       - assembles them into an autoKey and a risk name
//
// license-resolution-entry / -trigger / component-license-injection cover the
// well-formed values. This suite covers the ones nobody would type: Mongo
// operator objects in place of a string, member names of Object.prototype,
// `$`-prefixed and dotted keys, the whitespace characters `trim()` does and does
// not remove, astral pairs, and values sitting exactly on each bound.
//
// The single invariant that binds them together: NOTHING here may reach
// Object.prototype. `JSON.parse` genuinely creates an OWN `__proto__` key
// (riskProperties/managedFields.js already carries a hasOwn/setOwn pattern for
// it), so every corpus below is built the way a DDP payload really arrives.
// ---------------------------------------------------------------------------
const {
  MODULE_ID_MAX,
  COMPONENT_KEY_MAX,
  LICENSE_KEY_MAX,
  JUSTIFICATION_MAX,
  validateComponentTarget,
  validateResolutionInput,
  buildResolutionEntry,
  findSelectedEntry,
  findResolution,
  isResolutionUnchanged
} = require('../../imports/lib/licenseResolution/resolutionEntry');
const {
  findResolutionEntry,
  resolutionState,
  resolutionView,
  isJustificationValid,
  isStaleResolution,
  worstPolicyStatus,
  policyStatusWord
} = require('../../imports/client/ui/module/common/licenseResolution');
const {
  resolvedLicenseMap,
  resolvedLicenseKeys,
  injectResolvedLicenses
} = require('../../imports/server/scan/componentLicensePick');
const {isCatchAllLicenseKey} =
  require('../../imports/lib/licenseResolution/catchAllLicenses');

// Names that already mean something on every plain object. A component key or a
// license key spelling one of these must read as data and nothing else.
const PROTOTYPE_MEMBERS = ['__proto__', 'constructor', 'prototype', 'toString',
  'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__defineGetter__'];

// The shapes that turn a value position in a Mongo selector into an operator
// position. Every one of them is an OBJECT or an ARRAY, which is exactly why the
// validator's "must be a string" test is the load-bearing one.
const OPERATOR_PAYLOADS = [
  {$ne: ''}, {$gt: ''}, {$regex: '.*'}, {$exists: true}, {$where: '1==1'},
  {$in: ['a', 'b']}, ['$ne', ''], [{$ne: ''}]
];

// `$`-prefixed and dotted STRINGS, on the other hand, are ordinary data - and
// have to stay that way, because real keys spell dots all the time.
const HOSTILE_STRINGS = ['$ne', '$where', '$set', '$', '$$', 'a.b.c',
  'componentConfig.licensesSelected.key', '$set.componentConfig',
  'a\u0000b', 'a\u200bb', '\u202egnp', '\ud83d\ude00', 'npm:@scope/pkg',
  '../../etc/passwd', '<script>alert(1)</script>', "'; DROP TABLE --"];

// Characters String.prototype.trim() removes. A justification made only of these
// is an empty justification, whichever one the browser sent.
const BLANK_JUSTIFICATIONS = [' ', '\t', '\n', '\r', '\r\n', '   \t\n  ',
  '\u000b', '\f', '\u00a0', '\u1680', '\u2000', '\u2028', '\u2029',
  '\u202f', '\u205f', '\u3000', '\ufeff', '\ufeff \t\u00a0'];

const OK = {moduleId: 'mod123', componentKey: 'npm:left-pad', license: 'MIT',
  justification: 'Checked upstream, the package is MIT.'};

function withInput(overrides) {
  return Object.assign({}, OK, overrides);
}

// A payload built the way one really arrives: parsed from JSON, so `__proto__`
// is an OWN key rather than the prototype setter.
function fromJson(text) {
  return JSON.parse(text);
}

// Probe names nothing in this repo defines. If any of them appears on
// Object.prototype after a call, something did `obj[userKey] = value` without a
// hasOwn guard.
const POLLUTION_PROBES = ['polluted139', 'justification', 'license', 'origin',
  'licenses', 'key'];

function prototypeSnapshot() {
  return POLLUTION_PROBES.map((name) =>
    Object.prototype.hasOwnProperty.call(Object.prototype, name));
}

const CLEAN_PROTOTYPE = prototypeSnapshot();

afterEach(() => {
  // Runs after EVERY test in this file, so no single case has to remember it.
  expect(prototypeSnapshot()).toEqual(CLEAN_PROTOTYPE);
  expect({}.polluted139).toBeUndefined();
  expect([].polluted139).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The validator is what keeps an operator object out of a Mongo selector
// ---------------------------------------------------------------------------

describe('an operator payload never passes validation as any of the four arguments', () => {
  it('refuses one in moduleId, componentKey, license and justification alike', () => {
    // moduleId and componentKey both go into a selector verbatim
    // ({_id: moduleId, ...}, {'componentConfig.licensesSelected.key': componentKey}).
    // An object there is a selector clause; the type check is the only thing
    // standing between a browser and `{_id: {$ne: ''}}`.
    OPERATOR_PAYLOADS.forEach((payload) => {
      ['moduleId', 'componentKey', 'license', 'justification'].forEach((field) => {
        const out = validateResolutionInput(withInput({[field]: payload}));
        expect(out.ok).toBe(false);
        expect(out.reason).toBe('Invalid arguments');
      });
    });
  });

  it('refuses one in either argument of the undo path too', () => {
    OPERATOR_PAYLOADS.forEach((payload) => {
      expect(validateComponentTarget({moduleId: payload, componentKey: 'k'}).ok).toBe(false);
      expect(validateComponentTarget({moduleId: 'm', componentKey: payload}).ok).toBe(false);
    });
  });

  it('refuses a String object, which typeof reports as "object"', () => {
    // eslint-disable-next-line no-new-wrappers
    const boxed = new String('npm:left-pad');
    expect(validateResolutionInput(withInput({componentKey: boxed})).ok).toBe(false);
    expect(validateComponentTarget({moduleId: 'm', componentKey: boxed}).ok).toBe(false);
  });

  it('refuses an argument object whose own __proto__ carries the value', () => {
    // The shape a caller uses to try to reach a getter rather than a plain read.
    const payload = fromJson('{"moduleId": "m", "componentKey": "k", ' +
      '"license": "MIT", "__proto__": {"justification": "smuggled"}}');
    const out = validateResolutionInput(payload);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('Invalid arguments');
  });
});

describe('a $-prefixed or dotted STRING is ordinary data', () => {
  it('accepts one as componentKey and as license, unchanged', () => {
    // These are real: `maven:org.apache.commons:commons-lang3` is dotted, and a
    // company may key a private license anything at all. Rejecting them would
    // break the feature for keys that legitimately occur.
    HOSTILE_STRINGS.filter((s) => s.length <= LICENSE_KEY_MAX).forEach((value) => {
      expect(validateResolutionInput(withInput({componentKey: value})))
        .toEqual({ok: true});
      expect(validateResolutionInput(withInput({license: value}))).toEqual({ok: true});
    });
  });

  it('stores it verbatim in the entry rather than escaping or dropping it', () => {
    HOSTILE_STRINGS.forEach((value) => {
      const entry = buildResolutionEntry({componentKey: value, license: value,
        justification: value + ' reason', user: {_id: 'u1'}, now: new Date(0)});
      expect(entry.key).toBe(value);
      expect(entry.license).toBe(value);
      expect(entry.justification).toBe(value + ' reason');
    });
  });
});

// ---------------------------------------------------------------------------
// Object.prototype member names as data
// ---------------------------------------------------------------------------

describe('a prototype member name is a component key like any other', () => {
  it('validates, builds an entry and round-trips through JSON', () => {
    PROTOTYPE_MEMBERS.forEach((name) => {
      expect(validateResolutionInput(withInput({componentKey: name, license: name})))
        .toEqual({ok: true});
      const entry = buildResolutionEntry({componentKey: name, license: name,
        justification: 'because', user: {_id: 'u1'}, now: new Date(0)});
      expect(Object.prototype.hasOwnProperty.call(entry, 'key')).toBe(true);
      expect(entry.key).toBe(name);
      const roundTripped = fromJson(JSON.stringify(entry));
      expect(roundTripped.key).toBe(name);
    });
  });

  it('is found by both discriminators without consulting the prototype', () => {
    PROTOTYPE_MEMBERS.forEach((name) => {
      const list = fromJson(JSON.stringify([
        {key: name, license: 'MIT', comment: 'License set manually',
          justification: 'because'}]));
      const module = {componentConfig: {licensesSelected: list}};
      expect(findSelectedEntry(module, name).license).toBe('MIT');
      expect(findResolution(module, name).license).toBe('MIT');
      expect(findResolutionEntry(list, name).license).toBe('MIT');
      // ...and a component that is NOT in the list answers null, rather than
      // inheriting an answer from Object.prototype.
      expect(findSelectedEntry(module, 'npm:absent')).toBeNull();
      expect(findResolution(module, 'npm:absent')).toBeNull();
      expect(findResolutionEntry(list, 'npm:absent')).toBeNull();
    });
  });

  it('does not let a JSON-parsed licensesSelected array poison a lookup', () => {
    // An own `__proto__` KEY on the array's elements, and on the array's own
    // container - both are what JSON.parse produces from a crafted module PUT.
    const module = fromJson('{"componentConfig": {"licensesSelected": [' +
      '{"key": "npm:a", "license": "MIT", "comment": "c", ' +
      '"justification": "j", "__proto__": {"polluted139": true}}]}}');
    expect(findResolution(module, 'npm:a').license).toBe('MIT');
    expect(findResolutionEntry(module.componentConfig.licensesSelected, 'npm:a')
      .license).toBe('MIT');
  });

  it('resolvedLicenseMap keys a Map, so a crafted key answers for itself only', () => {
    PROTOTYPE_MEMBERS.forEach((name) => {
      const map = resolvedLicenseMap({componentConfig: {licensesSelected: [
        {key: name, license: 'PRIV-1', comment: 'c', justification: 'j'}]}});
      expect(map.get(name)).toEqual({license: 'PRIV-1', name: 'PRIV-1'});
      expect(map.get('npm:anything-else')).toBeUndefined();
      expect(map.size).toBe(1);
    });
  });

  it('resolvedLicenseMap reads the supplied name lookup with hasOwnProperty', () => {
    // The lookup is a plain object built by the caller from a Licenses query. A
    // license key spelling `constructor` must not pick up Object's constructor
    // as its display name.
    PROTOTYPE_MEMBERS.forEach((name) => {
      const map = resolvedLicenseMap({componentConfig: {licensesSelected: [
        {key: 'npm:a', license: name, comment: 'c', justification: 'j'}]}}, {});
      expect(map.get('npm:a')).toEqual({license: name, name: name});
      expect(typeof map.get('npm:a').name).toBe('string');
    });
  });

  it('injectResolvedLicenses writes a crafted key onto its own node only', () => {
    const scan = fromJson('{"dependencies": [' +
      '{"key": "__proto__", "licenses": []}, ' +
      '{"key": "constructor", "licenses": []}, ' +
      '{"key": "npm:innocent", "licenses": [{"name": "ISC"}]}]}');
    const map = resolvedLicenseMap({componentConfig: {licensesSelected: [
      {key: '__proto__', license: 'MIT', comment: 'c', justification: 'j'}]}});
    const result = injectResolvedLicenses(scan, map, null);
    expect(result).toEqual({nodes: 1, keys: ['__proto__']});
    expect(scan.dependencies[0].licenses[0].key).toBe('MIT');
    expect(scan.dependencies[1].licenses).toEqual([]);
    expect(scan.dependencies[2].licenses).toEqual([{name: 'ISC'}]);
  });

  it('the catch-all key test and the policy words consult no prototype', () => {
    PROTOTYPE_MEMBERS.concat(HOSTILE_STRINGS).forEach((name) => {
      expect(isCatchAllLicenseKey(name)).toBe(false);
      expect(policyStatusWord(name)).toBe('Pending');
      expect(worstPolicyStatus([name])).toBe('pending');
    });
  });
});

// ---------------------------------------------------------------------------
// The bounds, from both sides
// ---------------------------------------------------------------------------

describe('every bound is tested from both sides, in UTF-16 code units', () => {
  const BOUNDS = [
    ['moduleId', MODULE_ID_MAX],
    ['componentKey', COMPONENT_KEY_MAX],
    ['license', LICENSE_KEY_MAX],
    ['justification', JUSTIFICATION_MAX]
  ];

  it('accepts exactly the bound and refuses one more, for all four arguments', () => {
    BOUNDS.forEach(([field, max]) => {
      expect(validateResolutionInput(withInput({[field]: 'a'.repeat(max)})).ok).toBe(true);
      const over = validateResolutionInput(withInput({[field]: 'a'.repeat(max + 1)}));
      expect(over.ok).toBe(false);
      expect(over.reason).toBe('Invalid arguments');
    });
  });

  it('counts an astral character as the two code units .length reports', () => {
    // The server measures the RAW string; a grapheme-counting client would
    // disagree with it, so the corpus below pins which one wins.
    const emoji = '😀';
    expect(emoji.length).toBe(2);
    BOUNDS.forEach(([field, max]) => {
      expect(validateResolutionInput(withInput({[field]: emoji.repeat(max / 2)})).ok)
        .toBe(true);
      expect(validateResolutionInput(withInput({[field]: emoji.repeat(max / 2) + 'a'})).ok)
        .toBe(false);
    });
  });

  it('refuses an empty string everywhere it is required', () => {
    ['moduleId', 'componentKey', 'license'].forEach((field) => {
      expect(validateResolutionInput(withInput({[field]: ''})).ok).toBe(false);
    });
    // ...and the empty justification gets its OWN reason, which the UI renders
    // differently from a malformed request.
    expect(validateResolutionInput(withInput({justification: ''})))
      .toEqual({ok: false, reason: 'Justification required'});
  });
});

describe('a justification that is only whitespace is an empty justification', () => {
  it('is refused with its own reason, for every character trim() removes', () => {
    BLANK_JUSTIFICATIONS.forEach((blank) => {
      expect(blank.trim()).toBe('');
      expect(validateResolutionInput(withInput({justification: blank})))
        .toEqual({ok: false, reason: 'Justification required'});
    });
  });

  it('is refused by the client check too, so no blocked save reaches the network', () => {
    BLANK_JUSTIFICATIONS.forEach((blank) => expect(isJustificationValid(blank)).toBe(false));
  });

  it('is accepted the moment one visible character appears, and stored VERBATIM', () => {
    BLANK_JUSTIFICATIONS.forEach((blank) => {
      const text = blank + 'x' + blank;
      expect(validateResolutionInput(withInput({justification: text}))).toEqual({ok: true});
      expect(isJustificationValid(text)).toBe(true);
      // Not trimmed: trimming would make an identical resubmit read as a change
      // and would corrupt an audit record.
      expect(buildResolutionEntry({componentKey: 'k', license: 'MIT',
        justification: text, user: {_id: 'u'}, now: new Date(0)}).justification).toBe(text);
    });
  });
});

// ---------------------------------------------------------------------------
// The entry builder against a hostile user document
// ---------------------------------------------------------------------------

describe('buildResolutionEntry against a user document it cannot vouch for', () => {
  it('never leaves the author blank, whatever the user document looks like', () => {
    [{}, {_id: 'u'}, {_id: 'u', profile: {}}, {_id: 'u', profile: {name: ''}},
      {_id: 'u', emails: []}, {_id: 'u', emails: [{}]},
      fromJson('{"_id": "u", "__proto__": {"profile": {"name": "smuggled"}}}')]
      .forEach((user) => {
        const entry = buildResolutionEntry({componentKey: 'k', license: 'MIT',
          justification: 'j', user, now: new Date(0)});
        expect(typeof entry.resolvedBy).toBe('string');
        expect(entry.resolvedBy.length).toBeGreaterThan(0);
        expect(entry.resolvedBy).not.toBe('smuggled');
      });
  });

  it('takes the timestamp it is given and mints one only when it is not a Date', () => {
    const fixed = new Date('2026-09-09T10:00:00.000Z');
    expect(buildResolutionEntry({componentKey: 'k', license: 'MIT', justification: 'j',
      user: {_id: 'u'}, now: fixed}).resolvedAt).toBe(fixed);
    ['2026-09-09', 0, {}, null].forEach((now) => {
      const at = buildResolutionEntry({componentKey: 'k', license: 'MIT',
        justification: 'j', user: {_id: 'u'}, now}).resolvedAt;
      expect(at instanceof Date).toBe(true);
      expect(isNaN(at.getTime())).toBe(false);
    });
  });

  it('survives being handed no input object at all', () => {
    expect(() => buildResolutionEntry()).not.toThrow();
    expect(() => buildResolutionEntry(null)).not.toThrow();
  });
});

describe('isResolutionUnchanged cannot be talked into skipping a write', () => {
  const next = buildResolutionEntry({componentKey: 'k', license: 'MIT',
    justification: 'j', user: {_id: 'u'}, now: new Date(0)});

  it('is false for every stored entry whose justification is blank or absent', () => {
    BLANK_JUSTIFICATIONS.concat(['', undefined, null, 0, {}, []]).forEach((justification) => {
      expect(isResolutionUnchanged({key: 'k', license: 'MIT', justification}, next))
        .toBe(false);
    });
  });

  it('is false when only the whitespace of the justification differs', () => {
    // An audit record differing by a trailing newline is a DIFFERENT record.
    [' j', 'j ', 'j\n', '\tj', 'j '].forEach((justification) => {
      expect(isResolutionUnchanged({key: 'k', license: 'MIT', justification}, next))
        .toBe(false);
    });
  });

  it('is false when handed nothing to compare against', () => {
    [undefined, null, 0, '', {}, []].forEach((existing) => {
      expect(isResolutionUnchanged(existing, next)).toBe(false);
    });
    expect(isResolutionUnchanged({key: 'k', license: 'MIT', justification: 'j'}, null))
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The client's own decisions, on the same corpus
// ---------------------------------------------------------------------------

describe('the client decisions on hostile input', () => {
  it('resolutionState answers "none" rather than throwing for a broken context', () => {
    [undefined, null, 0, '', [], {}, {componentKey: ''}, {componentKey: 7},
      {componentKey: null}, fromJson('{"__proto__": {"componentKey": "x"}}')]
      .forEach((ctx) => {
        expect(resolutionState(ctx, [])).toBe('none');
      });
  });

  it('resolutionState survives a paths array full of junk', () => {
    const ctx = {componentKey: 'npm:a', paths: [null, 7, 'x', {}, [],
      {licenseCount: 'two'}, {reason: 5}]};
    // Every one of those is "no licenseCount I can trust", which is the harder
    // dead end and therefore the state that wins.
    expect(resolutionState(ctx, [])).toBe('unmatched-no-license');
    expect(() => resolutionState({componentKey: 'npm:a', paths: 'nope'}, [])).not.toThrow();
  });

  it('resolutionView refuses anything that is not one of our entries', () => {
    [undefined, null, 0, '', [], {}, {justification: ''}, {justification: '   '},
      {justification: 7}, {license: 'MIT'}].forEach((entry) => {
      expect(resolutionView(entry)).toBeNull();
    });
  });

  it('resolutionView never renders undefined into the panel', () => {
    const view = resolutionView({justification: 'j'});
    expect(view).toEqual({license: '', justification: 'j', author: '', date: ''});
  });

  it('resolutionView keeps an unparseable date as text rather than "Invalid Date"', () => {
    expect(resolutionView({justification: 'j', resolvedAt: 'not-a-date'}).date)
      .toBe('not-a-date');
    expect(resolutionView({justification: 'j', resolvedAt: new Date('nope')}).date).toBe('');
    expect(resolutionView({justification: 'j', resolvedAt: {}}).date).toBe('');
  });

  it('isJustificationValid refuses every non-string, and the over-length string', () => {
    [undefined, null, 0, 1, {}, [], ['x'], true, {toString: () => 'x'}]
      .forEach((v) => expect(isJustificationValid(v)).toBe(false));
    expect(isJustificationValid('a'.repeat(JUSTIFICATION_MAX))).toBe(true);
    expect(isJustificationValid('a'.repeat(JUSTIFICATION_MAX + 1))).toBe(false);
  });

  it('isStaleResolution is false at the boundary, not "stale by a millisecond"', () => {
    // Equal timestamps mean the analysis did NOT run after the resolution, so
    // the "Not applied" warning must not fire.
    const at = new Date('2026-09-09T10:00:00.000Z');
    const entry = {justification: 'j', resolvedAt: at};
    expect(isStaleResolution(entry, at, false)).toBe(false);
    expect(isStaleResolution(entry, new Date(at.getTime() + 1), false)).toBe(true);
    expect(isStaleResolution(entry, new Date(at.getTime() - 1), false)).toBe(false);
  });

  it('isStaleResolution refuses to guess from an unparseable date', () => {
    const entry = {justification: 'j', resolvedAt: new Date('2026-09-09T10:00:00.000Z')};
    ['not-a-date', {}, [], NaN].forEach((analysisDate) => {
      expect(isStaleResolution(entry, analysisDate, false)).toBe(false);
    });
    expect(isStaleResolution({justification: 'j', resolvedAt: 'nope'},
      new Date(), false)).toBe(false);
  });

  it('worstPolicyStatus ranks worst-first and never invents a verdict', () => {
    expect(worstPolicyStatus(['ok', 'violations', 'warnings'])).toBe('violations');
    expect(worstPolicyStatus(['ok', 'warnings'])).toBe('warnings');
    expect(worstPolicyStatus(['ok'])).toBe('ok');
    expect(worstPolicyStatus([])).toBe('pending');
    [undefined, null, 'ok', 0, {}].forEach((v) =>
      expect(worstPolicyStatus(v)).toBe('pending'));
    // An unknown status beside a known one must not suppress the known one...
    expect(worstPolicyStatus(['__proto__', 'violations'])).toBe('violations');
    // ...and on its own it is not a verdict.
    expect(worstPolicyStatus(['OK', 'Violations'])).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// The injection map, on the same corpus
// ---------------------------------------------------------------------------

describe('resolvedLicenseMap / resolvedLicenseKeys against a hostile module document', () => {
  it('ignores every entry whose key or license is not a usable string', () => {
    const module = fromJson(JSON.stringify({componentConfig: {licensesSelected: [
      {key: {$ne: ''}, license: 'MIT', comment: 'c', justification: 'j'},
      {key: 'npm:a', license: {$ne: ''}, comment: 'c', justification: 'j'},
      {key: 'npm:b', license: 'MIT', comment: 'c', justification: {$ne: ''}},
      {key: '', license: 'MIT', comment: 'c', justification: 'j'},
      {key: 'npm:c', license: '', comment: 'c', justification: 'j'},
      {key: 'npm:ok', license: 'ISC', comment: 'c', justification: 'j'}
    ]}}));
    expect([...resolvedLicenseMap(module).keys()]).toEqual(['npm:ok']);
    expect(resolvedLicenseKeys(module)).toEqual(['ISC']);
  });

  it('keeps the LAST entry when a crafted document repeats a component key', () => {
    // `licensesSelected` carries no uniqueness constraint and the REST module
    // PUT writes the array wholesale, so duplicates are storable. Pinned so the
    // injection's choice is a decision rather than an accident.
    const module = {componentConfig: {licensesSelected: [
      {key: 'npm:a', license: 'FIRST', comment: 'c', justification: 'j1'},
      {key: 'npm:a', license: 'LAST', comment: 'c', justification: 'j2'}
    ]}};
    expect(resolvedLicenseMap(module).get('npm:a').license).toBe('LAST');
    expect(resolvedLicenseKeys(module)).toEqual(['LAST']);
  });

  it('does not choke on an enormous licensesSelected array', () => {
    const entries = [];
    for (let i = 0; i < 5000; i++) {
      entries.push({key: 'npm:p' + i, license: 'MIT', comment: 'c', justification: 'j'});
    }
    const map = resolvedLicenseMap({componentConfig: {licensesSelected: entries}});
    expect(map.size).toBe(5000);
    expect(resolvedLicenseKeys({componentConfig: {licensesSelected: entries}}))
      .toEqual(['MIT']);
  });
});

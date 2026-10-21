/* eslint-disable no-undef */
// Module-settings list helpers used to stamp a display-only `index` straight onto the
// documents they were rendering (`o.index = i`, `data.index = selectedIndex`). Those objects
// are live Minimongo documents, so the mutation travelled into the array that the very next
// `updateCollection` / `updateUserConfig` call persisted - writing a field that appears in no
// entry schema into MongoDB.
//
// `updateCollection` (imports/server/collections/modules.js) `$set`s the array it is handed
// verbatim; nothing on the server strips `index`. The client-side `ListHelper.forStorage()` is
// therefore the ONLY guard, which makes it worth real coverage rather than a wiring check
// alone.
//
// ListHelper.js imports Meteor modules and cannot be `require`d under Jest. Rather than retype
// the functions into the spec (which would test a copy), the real source is loaded with its
// imports stubbed - see test_api/helpers/loadMeteorModule.js.
const _ = require('underscore');
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const noop = function () {};

// Loaded ONCE for the whole file. Loading per-test would re-evaluate the module and hide any
// module-level state, and would make the assertions depend on test order.
const {ListHelper} = loadMeteorModule('imports/client/ui/lib/ListHelper.js', {
  'meteor/meteor': {Meteor: {user: function () { return {_id: 'u1', profile: {companyId: 'c1'}}; }, callAsync: noop}},
  'meteor/templating': {Template: {parentData: function () { return {}; }}},
  'meteor/session': {Session: {set: noop, get: noop}},
  'meteor/alanning:roles': {Roles: {userIsInRole: function () { return true; }}},
  'underscore': _,
  '/imports/lib/utils': {ComponentRegExp: {check: function () { return true; }}}
});

const LIST_FILES = [
  'imports/client/ui/module/module-settings/component-list.js',
  'imports/client/ui/module/module-settings/cve-list.js',
  'imports/client/ui/module/module-settings/license-list.js',
  'imports/client/ui/module/module-settings/obligation-config-list.js'
];

describe('ListHelper module surface', () => {
  it('exposes the two helpers the list templates now depend on', () => {
    expect(typeof ListHelper.forStorage).toBe('function');
    expect(typeof ListHelper.withDisplayIndex).toBe('function');
  });
});

describe('ListHelper.forStorage - strips the display-only index', () => {
  it('removes `index` from every entry', () => {
    const out = ListHelper.forStorage([
      {key: 'npm:a', index: 0},
      {key: 'npm:b', index: 1}
    ]);
    out.forEach((entry) => expect(entry).not.toHaveProperty('index'));
  });

  it('removes `index` when it is 0 (a falsy value a truthiness check would miss)', () => {
    const [entry] = ListHelper.forStorage([{key: 'npm:only', index: 0}]);
    expect(Object.prototype.hasOwnProperty.call(entry, 'index')).toBe(false);
  });

  it('keeps every field that is NOT display-only', () => {
    const [entry] = ListHelper.forStorage([{
      key: 'npm:lodash', version: '4.17.21', approved: false, comment: 'ok',
      projectItem: undefined, index: 7
    }]);
    expect(entry).toEqual({
      key: 'npm:lodash', version: '4.17.21', approved: false, comment: 'ok',
      projectItem: undefined
    });
  });

  it('leaves entries that never carried an index untouched', () => {
    expect(ListHelper.forStorage([{key: 'npm:a', version: '1.0.0'}]))
      .toEqual([{key: 'npm:a', version: '1.0.0'}]);
  });
});

describe('ListHelper.forStorage - does not mutate the caller (the Minimongo doc)', () => {
  it('leaves the source array and its entries exactly as they were', () => {
    const entryA = {key: 'npm:zeta', index: 1};
    const entryB = {key: 'npm:alpha', index: 0};
    const source = [entryA, entryB];
    const snapshot = JSON.parse(JSON.stringify(source));

    ListHelper.forStorage(source);

    expect(source).toEqual(snapshot);
    expect(source[0]).toBe(entryA);   // no reordering of the caller's array
    expect(entryA.index).toBe(1);     // no field removed from the caller's document
  });

  it('returns fresh objects, not references into the input', () => {
    const entry = {key: 'npm:a', index: 0};
    const [out] = ListHelper.forStorage([entry]);
    expect(out).not.toBe(entry);
    out.mutated = true;
    expect(entry).not.toHaveProperty('mutated');
  });
});

describe('ListHelper.forStorage - deterministic alphabetical order', () => {
  it('sorts component/license entries by `key`', () => {
    const out = ListHelper.forStorage([
      {key: 'npm:zeta'}, {key: 'npm:alpha'}, {key: 'npm:mid'}
    ]);
    expect(_.pluck(out, 'key')).toEqual(['npm:alpha', 'npm:mid', 'npm:zeta']);
  });

  it('sorts case-insensitively, so "Apache" and "apache" do not straddle "MIT"', () => {
    const out = ListHelper.forStorage([
      {key: 'MIT'}, {key: 'apache-2.0'}, {key: 'Apache-1.1'}
    ]);
    expect(_.pluck(out, 'key')).toEqual(['Apache-1.1', 'apache-2.0', 'MIT']);
  });

  it('sorts CVE entries by `cveKey` and obligation entries by `obligationKey`', () => {
    expect(_.pluck(ListHelper.forStorage([
      {cveKey: 'CVE-2024-9999'}, {cveKey: 'CVE-2023-0001'}
    ]), 'cveKey')).toEqual(['CVE-2023-0001', 'CVE-2024-9999']);

    expect(_.pluck(ListHelper.forStorage([
      {obligationKey: 'share-alike'}, {obligationKey: 'attribution'}
    ]), 'obligationKey')).toEqual(['attribution', 'share-alike']);
  });

  it('falls back to `name` when there is no key of any kind', () => {
    expect(_.pluck(ListHelper.forStorage([{name: 'Zulu'}, {name: 'alpha'}]), 'name'))
      .toEqual(['alpha', 'Zulu']);
  });

  it('is stable for entries with no sortable field (input order preserved)', () => {
    const out = ListHelper.forStorage([{a: 1}, {a: 2}, {a: 3}]);
    expect(_.pluck(out, 'a')).toEqual([1, 2, 3]);
  });

  it('is idempotent - storing an already-stored list changes nothing', () => {
    const once = ListHelper.forStorage([{key: 'npm:b', index: 1}, {key: 'npm:a', index: 0}]);
    expect(ListHelper.forStorage(once)).toEqual(once);
  });
});

describe('ListHelper.forStorage - degenerate input', () => {
  it('returns an empty array for an empty list', () => {
    expect(ListHelper.forStorage([])).toEqual([]);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a plain object', {key: 'npm:a'}],
    ['a string', 'npm:a']
  ])('passes %s straight through instead of throwing', (_label, value) => {
    expect(() => ListHelper.forStorage(value)).not.toThrow();
    expect(ListHelper.forStorage(value)).toBe(value);
  });

  it('survives null holes inside the list', () => {
    expect(() => ListHelper.forStorage([null, {key: 'npm:a'}])).not.toThrow();
  });
});

describe('ListHelper.withDisplayIndex - a render-time copy', () => {
  it('adds the index without touching the stored document', () => {
    const stored = {key: 'npm:a', version: '1.0.0'};
    const rendered = ListHelper.withDisplayIndex(stored, 3);

    expect(rendered).toEqual({key: 'npm:a', version: '1.0.0', index: 3});
    expect(rendered).not.toBe(stored);
    expect(stored).not.toHaveProperty('index');
  });

  it('handles index 0 (the first row) as a real value', () => {
    expect(ListHelper.withDisplayIndex({key: 'npm:a'}, 0)).toEqual({key: 'npm:a', index: 0});
  });

  it('overwrites a stale index rather than keeping it', () => {
    expect(ListHelper.withDisplayIndex({key: 'npm:a', index: 9}, 1).index).toBe(1);
  });

  // Both directions: the copy carries `index` for the template, and forStorage takes it back
  // off again. A regression that broke either half would leak `index` into MongoDB.
  it('round-trips: withDisplayIndex adds it, forStorage removes it', () => {
    const stored = {key: 'npm:a', version: '1.0.0'};
    const rendered = ListHelper.withDisplayIndex(stored, 4);
    expect(rendered).toHaveProperty('index', 4);
    expect(ListHelper.forStorage([rendered])).toEqual([stored]);
  });
});

describe('list templates route every storage payload through forStorage', () => {
  // Comment-stripped, so a commented-out call cannot make these pass.
  const sources = LIST_FILES.reduce((acc, file) => {
    acc[file] = readSourceWithoutComments(file);
    return acc;
  }, {});

  it.each(LIST_FILES)('%s builds `dataWithout` only via ListHelper.forStorage', (file) => {
    const src = sources[file];
    const assignments = src.match(/(?:const|let|var)\s+dataWithout\s*=\s*[^\n]*/g) || [];
    expect(assignments.length).toBeGreaterThan(0);
    assignments.forEach((line) => expect(line).toMatch(/dataWithout\s*=\s*ListHelper\.forStorage\(/));
  });

  // Opposite direction: the pre-fix form must be gone, not merely outnumbered.
  it.each(LIST_FILES)('%s no longer assigns dataWithout straight from _.reject', (file) => {
    expect(sources[file]).not.toMatch(/dataWithout\s*=\s*_\.reject\(/);
  });

  it.each(LIST_FILES)('%s renders rows via withDisplayIndex, never `o.index = i`', (file) => {
    const src = sources[file];
    expect(src).toMatch(/ListHelper\.withDisplayIndex\(/);
    expect(src).not.toMatch(/\bo\.index\s*=\s*i\b/);
  });

  it.each(LIST_FILES)('%s no longer stamps `index` onto the selected form document', (file) => {
    expect(sources[file]).not.toMatch(/\bdata\.index\s*=\s*selectedIndex\b/);
  });

  it.each(LIST_FILES)('%s no longer stamps `_id` onto the selected form document', (file) => {
    // cve/license/obligation lists also wrote `data._id = this.docId` onto the live doc.
    expect(sources[file]).not.toMatch(/\bdata\._id\s*=\s*this\.docId\b/);
  });

  it('every list file imports ListHelper (so the calls above resolve)', () => {
    LIST_FILES.forEach((file) => {
      expect(sources[file]).toMatch(/import\s+\{[^}]*\bListHelper\b[^}]*\}\s+from/);
    });
  });

  it('the shared submit hook in ListHelper stores through forStorage too', () => {
    const src = readSourceWithoutComments('imports/client/ui/lib/ListHelper.js');
    expect(src).toMatch(/dataWithout\s*=\s*self\.forStorage\(/);
    // ...and still deletes `index` off the submitted form document before it is pushed.
    expect(src).toMatch(/delete\s+insertDoc\.index/);
  });
});

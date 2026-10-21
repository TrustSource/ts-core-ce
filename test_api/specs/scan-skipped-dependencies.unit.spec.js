// Scan hardening item A - the per-run record of dependency nodes processScan could not handle,
// and item H - the targeted scan write that carries it.
//
// imports/server/scan/skippedDependencies.js is Meteor-free CommonJS for the same reason
// ./rootDependency.js is: `yarn meteor-test` does not boot on this checkout, so logic that
// has to be unit-tested is written so plain Jest can require it. The behaviour against a
// running server is in scan-crash-isolation.spec.js.
const fs = require('fs');
const path = require('path');

const {
  createSkipCollector,
  SKIPPED_DEPENDENCIES_LIMIT,
  SKIP_NO_IDENTIFIER,
  SKIP_PROCESSING_FAILED
} = require('../../imports/server/scan/skippedDependencies');
const {MAX_ECHOED_TEXT} = require('../../imports/server/scan/textLimits');

const REPO = path.join(__dirname, '..', '..');

// Comment-aware read. processScan.js carries long comments naming every identifier under
// assertion, so a plain substring match against the raw file passes on prose alone.
function readCode(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('#134 A - skipped dependency collector', () => {
  it('records the fields that make an entry locatable in a 13k-node tree', () => {
    const skipped = createSkipCollector();
    skipped.record({name: 'bad', purl: 'not-a-purl'}, '/npm:root/', SKIP_NO_IDENTIFIER);

    expect(skipped.count()).toBe(1);
    expect(skipped.entries()).toEqual([{
      path: '/npm:root/',
      name: 'bad',
      purl: 'not-a-purl',
      reason: SKIP_NO_IDENTIFIER
    }]);
  });

  it('omits fields the node does not carry rather than storing undefined', () => {
    const skipped = createSkipCollector();
    skipped.record({name: 'bare'}, '/', SKIP_NO_IDENTIFIER);
    expect(Object.keys(skipped.entries()[0]).sort()).toEqual(['name', 'path', 'reason']);
  });

  // The scan document is published to the tenant's users by Meteor.publish('scanDetail'),
  // so the entry names the FAILURE CLASS and not the driver's sentence about it - an E11000
  // quotes the conflicting document back, which is another tenant's data as easily as this
  // one's. The full text stays on the server log.
  it('summarises the failure instead of storing raw driver text', () => {
    const skipped = createSkipCollector();
    const mongoish = new Error('E11000 duplicate key error collection: meteor.components ' +
      'index: key_1_unique dup key: { key: "npm:someone-elses" }');
    mongoish.name = 'MongoServerError';
    mongoish.code = 11000;
    skipped.record({name: 'boom', key: 'npm:boom'}, '/', SKIP_PROCESSING_FAILED, mongoish);
    const entry = skipped.entries()[0];
    expect(entry.reason).toBe(SKIP_PROCESSING_FAILED);
    expect(entry.message).toBe('MongoServerError 11000');
    expect(entry.message).not.toContain('someone-elses');
    expect(entry.key).toBe('npm:boom');
  });

  it('summarises a plain Error and a Meteor.Error alike', () => {
    const skipped = createSkipCollector();
    skipped.record({name: 'a'}, '/', SKIP_PROCESSING_FAILED, new Error('mongo said no'));
    // Meteor.Error's shape, without needing Meteor in a plain Jest worker.
    const meteorish = new Error('Access Denied [403]');
    meteorish.error = 403;
    meteorish.reason = 'Access Denied';
    skipped.record({name: 'b'}, '/', SKIP_PROCESSING_FAILED, meteorish);
    expect(skipped.entries().map((e) => e.message)).toEqual(['Error', 'Error 403']);
  });

  // Findings 4 and 6: ApiDependencySchema.name declares a `min` and no `max`, so these
  // fields arrive unbounded - and they are both stored here and echoed back in the 400.
  it('caps every caller-supplied string it stores', () => {
    const skipped = createSkipCollector();
    const huge = 'x'.repeat(500000);
    skipped.record({name: huge, key: huge, purl: huge}, '/' + huge + '/',
      SKIP_NO_IDENTIFIER);
    const entry = skipped.entries()[0];
    ['name', 'key', 'purl', 'path'].forEach((field) => {
      expect(entry[field].length).toBeLessThanOrEqual(MAX_ECHOED_TEXT);
    });
    expect(entry.name.startsWith('xxx')).toBe(true);
  });

  // Criterion 8: 150 unidentifiable nodes -> 100 entries, count 150.
  it('caps the entry list but keeps the count exact', () => {
    const skipped = createSkipCollector();
    for (let i = 0; i < 150; i++) {
      skipped.record({name: 'n' + i}, '/', SKIP_NO_IDENTIFIER);
    }
    expect(SKIPPED_DEPENDENCIES_LIMIT).toBe(100);
    expect(skipped.entries()).toHaveLength(SKIPPED_DEPENDENCIES_LIMIT);
    expect(skipped.count()).toBe(150);
    // The cap keeps the FIRST entries - the ones still correlatable with the head of the
    // tree - rather than a sliding window of the last hundred.
    expect(skipped.entries()[0].name).toBe('n0');
    expect(skipped.entries()[99].name).toBe('n99');
  });

  it('is per-instance, so one run cannot attribute its skips to another', () => {
    const a = createSkipCollector();
    const b = createSkipCollector();
    a.record({name: 'x'}, '/', SKIP_NO_IDENTIFIER);
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(0);
    expect(b.entries()).toEqual([]);
  });

  it('cannot be grown after the fact through the returned entry list', () => {
    const skipped = createSkipCollector();
    skipped.record({name: 'x'}, '/', SKIP_NO_IDENTIFIER);
    skipped.entries().push({path: '/', name: 'injected', reason: 'nope'});
    expect(skipped.entries()).toHaveLength(1);
  });

  it('survives a node that is not an object at all', () => {
    const skipped = createSkipCollector();
    expect(() => skipped.record(null, '/', SKIP_NO_IDENTIFIER)).not.toThrow();
    expect(skipped.count()).toBe(1);
  });
});

describe('#134 H - the scan is written field by field', () => {
  it('processScan replaces the whole-document write with a $set plus an $unset', () => {
    const source = readCode(path.join(REPO, 'imports', 'server', 'scan', 'processScan.js'));
    expect(source).not.toMatch(/Scans\.updateAsync\(\s*\{_id: scan\._id[^}]*\}\s*,\s*scan\s*\)/);
    expect(source).toMatch(/\$unset/);
  });

  // The sibling call site: leaving it alone would have relocated the clobbering bug rather
  // than removing it. It has to read IDENTICALLY to the processScan one - guarded, because
  // cleanDoc() drops an empty array and an unguarded $set then wrote `dependencies: null`,
  // and company-scoped, because every other selector on this path is.
  it('Modules.PropagateRootLicense writes only the dependencies it changed', () => {
    const modules = readCode(path.join(REPO, 'imports', 'server', 'collections', 'modules.js'));
    expect(modules).not.toMatch(/Scans\.updateAsync\(\{_id: scan\._id\}, scan\)/);
    expect(modules).toMatch(
      /if \(Array\.isArray\(scan\.dependencies\)\) \{\s*await Scans\.updateAsync\(\s*\{_id: scan\._id, companyId\}\s*,\s*\{\$set: \{dependencies: scan\.dependencies\}\}\)/);
  });
});

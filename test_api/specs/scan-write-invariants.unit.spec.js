// Scan hardening items E, F, G and the crash guard on Component.store().
//
// These are structural invariants: "the string comparison is gone", "the hash is gone",
// "the fire-and-forget writes have a catch". They are asserted against the source because
// the alternative - proving a negative about how many Mongo operations ran - is what the
// architect replaced with the equivalence assertions in scan-write-equivalence.spec.js.
// Both halves are needed: this one says the old mechanism is not still there, that one says
// the new one produces the same documents.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

// Comment-aware read: both files carry long comments naming every identifier under
// assertion, so a plain substring match against the raw text passes on prose alone.
function readCode(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const processScan = readCode(path.join(REPO, 'imports', 'server', 'scan', 'processScan.js'));
const component = readCode(path.join(REPO, 'imports', 'lib', 'component', 'Component.js'));

describe('#134 E - the component lookup writes only on a miss', () => {
  // An unconditional upsert ran a WRITE for every dependency, even the overwhelming
  // majority that already exist, and was then followed by a find anyway: about 1832 round
  // trips for the production p95 tree of 916 nodes. The lookup comes first now and the
  // write only happens on a miss. (Matched on the `{key: lowerKey}` selector rather than on
  // the collection name, because `InfrastructureComponents.findOneAsync` ends with the same
  // characters as `Components.findOneAsync` and made an earlier version of this assertion
  // pass on the wrong statement.)
  it('looks up before it upserts', () => {
    const lookup = processScan.search(/findOneAsync\(\{key: lowerKey\}\)/);
    const upsert = processScan.search(/Components\.upsertAsync\(/);
    expect(lookup).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(upsert);
  });

  // The old `$or: [{key}, {oldKey}]` returned whichever document Mongo yielded first when a
  // key existed as `key` on one document and as `oldKey` on another - and the unconditional
  // upsert running before it is what created that second document. Two point lookups, in a
  // fixed order, make the answer deterministic; both are index-served.
  it('resolves key and oldKey as two ordered point lookups, not one $or', () => {
    expect(processScan).not.toMatch(/\$or:\s*\[\{key:\s*lowerKey\}/);
    expect(processScan).toMatch(/findOneAsync\(\{key: lowerKey\}\)/);
    expect(processScan).toMatch(/findOneAsync\(\{oldKey: lowerKey\}\)/);
  });
});

describe('#134 F - the change tracker replaces the string comparison', () => {
  it('no longer serialises the component document to detect a change', () => {
    expect(processScan).not.toMatch(/JSON\.stringify\(\s*component\.data\(\)\s*\)/);
    expect(processScan).toMatch(/component\.hasChanged\(\)/);
  });

  // Component.setUrl / setField mark the document changed even when
  // nothing actually changes, and updateComponentFromDependency calls setUrl four times per
  // node. Swapping in hasChanged() without guarding those call sites would have written on
  // essentially every existing component - a bigger write set than the one being removed.
  // The guards live at the call sites, not in the setters: those are shared with about
  // twenty client-side edit pages that call store() on their own schedule.
  it('guards every setter that marks the document changed unconditionally', () => {
    expect(processScan).toMatch(/function setUrlIfPresent/);
    expect(processScan).not.toMatch(/component\.setUrl\('repository'/);
    expect(processScan).toMatch(/setUrlIfPresent\(component, 'repository'/);
    // crypto_algorithms / ai_models are merged lists: only write when the merge differs.
    expect(processScan).toMatch(/!_\.isEqual\(newList, currentList\)/);
    expect(processScan).toMatch(/!_\.isEqual\(newAiList, currentAiList\)/);
  });
});

describe('#134 G - the unread per-node hash is gone', () => {
  it('neither computes nor declares it', () => {
    expect(processScan).not.toMatch(/hashCode/);
    expect(processScan).not.toMatch(/dependency\.hash\s*=/);
  });
});

describe('#134 I - the license expansion works on its own list', () => {
  // withoutRootPickLicenses returns its INPUT array when it strips nothing, so the old
  // `const tempList = scanLicenses` was an alias of dependency.licenses and every expanded
  // key was pushed onto the scan document that then got stored.
  it('does not push into the list it was handed', () => {
    expect(processScan).not.toMatch(/tempList\.push/);
    expect(processScan).toMatch(/function expandScanLicenses/);
  });
});

describe('#134 J - the root-license pick is pushed conditionally', () => {
  // The read of licensesSelected and the $push that followed were not atomic, so two
  // concurrent scans of one module both saw nothing and both pushed.
  it('makes the "not already present" test part of the update selector', () => {
    expect(processScan).toMatch(/'componentConfig\.licensesSelected\.key':\s*\{\$ne:/);
  });
});

describe('#134 - a losing insert race must not take the process down', () => {
  // Observed 2026-09-04 from ordinary sequential uploads: two runs raced on a brand-new
  // key, the loser's un-awaited Components.insertAsync rejected with E11000, nothing was
  // attached to that promise, and Node exited - the whole Meteor process, for one duplicate
  // component. Both fire-and-forget writes in store() now degrade to a logged warning.
  it('both fire-and-forget writes in Component.store() have a catch', () => {
    // The helper attaches the handler and hands the original promise straight back, so
    // callers see exactly what they saw before.
    expect(component).toMatch(/function catchStoreRejection\([\s\S]*?promise\.catch\(/);

    const store = component.slice(component.indexOf('Component.prototype.store ='));
    const update = store.match(/[^\n]*Components\.updateAsync\(data\._id, modifier[^\n]*/);
    const insert = store.match(/[^\n]*Components\.insertAsync\(data[^\n]*/);
    expect(update).not.toBeNull();
    expect(insert).not.toBeNull();
    expect(update[0]).toContain('catchStoreRejection(');
    expect(insert[0]).toContain('catchStoreRejection(');
  });
});

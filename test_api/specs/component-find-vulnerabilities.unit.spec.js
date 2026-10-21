/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// The fourth call site of the synchronous `Vulnerability.findAll`.
//
// `Component.findVulnerabilities` and its COTS/infrastructure twins are defined
// INSIDE `if (Meteor.isServer)`, and until this change they reached the
// synchronous `Vulnerability.findAll`, which answers [] on a Meteor 3 server
// because the cursor read it performs is asynchronous there. They were therefore
// guaranteed no-ops: every version they were asked about came back with no
// vulnerabilities, silently, on the only platform they exist on.
//
// WHAT THIS COVERS
//
//   1. The three `findVulnerabilities` methods, loaded from the REAL sources and
//      driven through the REAL `Vulnerability` module over a cursor that behaves
//      the way a Meteor 3 server cursor behaves: `fetchAsync` answers, `fetch`
//      and `forEach` throw. A revert to the sync helper fails these outright.
//   2. `imports/lib/interactors/modules/getComponents.js` - the one caller -
//      awaiting the method. Without the await the components it returns are
//      built before the join resolves, so the assertion that the returned data
//      carries the finding is what pins the await.
//   3. A source-level guard that no server-only method reaches sync `findAll`.
//
// Every module under test is the shipped file, loaded through `loadMeteorModule`
// with recording stand-ins; the helper throws when an import has no stub, so a
// new module edge fails this suite loudly instead of binding undefined.
// ---------------------------------------------------------------------------
const _ = require('underscore');
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');
const impact = require('../../imports/lib/component/cvssImpact');

const COMPANY = 'company-owner';
const KEY = 'npm:left-pad';
const VERSION = '1.0.0';

// --- a cursor that behaves like a Meteor 3 SERVER cursor --------------------
// The whole defect is that the synchronous reads answer nothing there. Making
// them throw is stricter than reproducing that (which would let a regression
// pass as an empty list) and is safe: no code under test may call them.
function serverCursor(docs) {
  const refuse = function () {
    throw new Error('synchronous cursor read on a Meteor 3 server');
  };
  return {
    fetch: refuse,
    forEach: refuse,
    map: refuse,
    count: refuse,
    fetchAsync: async function () { return docs.slice(); }
  };
}

function cveDoc(key, version, cveId, score) {
  return {
    key: key,
    versions: [{
      version: version,
      confidence: 'HIGH',
      vendor: 'acme',
      product: 'left-pad',
      cves: [{
        cve_id: cveId,
        impact: {cvss3: {baseScore: score, vectorString: 'CVSS:3.1/AV:N'}}
      }]
    }]
  };
}

// Only the two operators the real selectors build.
function cveMatches(doc, selector) {
  if (doc.key !== selector.key) {
    return false;
  }
  const wanted = (selector['versions.version'] || {}).$in || [];
  return (doc.versions || []).some(function (v) { return wanted.indexOf(v.version) !== -1; });
}

function manualMatches(doc, selector) {
  const wanted = (selector['ecs.value'] || {}).$in || [];
  return doc.companyId === selector.companyId &&
    wanted.indexOf(doc.ecs && doc.ecs.value) !== -1;
}

function collectionOf(docs, matcher) {
  const calls = [];
  return {
    calls: calls,
    find: function (selector, options) {
      calls.push({selector: selector, options: options});
      return serverCursor(docs.filter(function (doc) { return matcher(doc, selector); }));
    }
  };
}

// --- the pieces of Utils these modules reach --------------------------------
// Faithful to imports/lib/utils.js: the version is the last `:`-separated
// segment, and groupedImpactVersions normalises `cvss31` down to `cvss3`.
const Utils = {
  ComponentKey: function (key) {
    const parts = String(key || '').split(':');
    this.manager = parts[0];
    this.version = parts[parts.length - 1];
    this.component = parts.slice(1, parts.length - 1).join(':');
  },
  groupedImpactVersions: function (imp) {
    if (!imp) { return imp; }
    const supported = ['cvss2', 'cvss3', 'cvss4', 'cvss5'];
    const out = {};
    Object.keys(imp).forEach(function (key) {
      const matched = supported.find(function (s) { return key.indexOf(s) === 0; });
      if (matched) { out[matched] = imp[key]; }
    });
    return out;
  }
};

function meteorStub() {
  return {Meteor: {isServer: true, isClient: false, isCordova: false, settings: {}}};
}

function loadVulnerability(cves, manual) {
  return loadMeteorModule('imports/lib/component/Vulnerability.js', {
    'underscore': _,
    'meteor/meteor': meteorStub(),
    'meteor/vlasky:galvanized-iron-router': {Router: {url: function () { return 'https://vl.example'; }, routes: {}}},
    '/imports/lib/collections/cves': {default: cves},
    '/imports/lib/collections/manualVulnerabilities': {default: manual},
    '/imports/lib/utils': {default: Utils},
    '/imports/lib/component/cvssImpact': impact
  }).default;
}

// Version.js and its own little tree, loaded real - findVulnerabilities writes
// through Version.data(), so a stand-in here would test the stand-in.
function loadVersion() {
  const QOS = loadMeteorModule('imports/lib/component/QOS.js', {'underscore': _}).default;
  const License = loadMeteorModule('imports/lib/component/License.js', {'./QOS.js': {default: QOS}}).default;
  const Checksum = loadMeteorModule('imports/lib/component/Checksum.js', {'./QOS': {default: QOS}}).default;
  return loadMeteorModule('imports/lib/component/Version.js', {
    'underscore': _,
    './License': {default: License},
    './Checksum': {default: Checksum},
    './QOS': {default: QOS}
  }).default;
}

// SemverExt only ORDERS the version list, which is not what these assertions are
// about, and its real source cannot go through loadMeteorModule (its single
// import line carries a trailing comment, which the helper's rewrite refuses).
// A stable passthrough is therefore honest here rather than a shortcut.
const SemverExt = {arraySortByVersion: function (versions) { return (versions || []).slice(); }};

function componentDeps(Vulnerability) {
  return {
    'meteor/meteor': meteorStub(),
    'underscore': _,
    'packageurl-js': {PackageURL: function () { this.toString = function () { return 'pkg:stub'; }; }},
    '/imports/lib/schemas/componentSchema': {ComponentSchema: {}},
    '/imports/lib/collections/components': {default: collectionOf([], function () { return false; })},
    '/imports/lib/collections/infrastructureComponents': {default: collectionOf([], function () { return false; })},
    '/imports/lib/collections/cotsComponents': {default: collectionOf([], function () { return false; })},
    '/imports/lib/component/Vulnerability': {default: Vulnerability},
    '/imports/lib/component/SemverExt': {default: SemverExt},
    './Version': {default: loadVersion()},
    './SemverExt': {default: SemverExt},
    '/imports/lib/utils': {default: Utils},
    '/imports/lib/component/keyFromPurl': {splitComponentKey: function () { return {}; }}
  };
}

function componentDoc() {
  return {
    key: KEY,
    name: 'left-pad',
    versions: [{version: VERSION, licenses: [{key: 'MIT'}]}]
  };
}

// The three server-only classes, each driven end to end over the real join.
const SUBJECTS = [
  {label: 'Component', path: 'imports/lib/component/Component.js'},
  {label: 'COTSComponent', path: 'imports/lib/component/COTSComponent.js'},
  {label: 'InfrastructureComponent', path: 'imports/lib/component/InfrastructureComponent.js'}
];

describe('#138 findVulnerabilities reads the CVE join on the server', function () {
  SUBJECTS.forEach(function (subject) {
    describe(subject.label, function () {
      it('populates version data from `cves` instead of answering nothing', async function () {
        const cves = collectionOf([cveDoc(KEY, VERSION, 'CVE-2026-0001', 9.1)], cveMatches);
        const manual = collectionOf([], manualMatches);
        const Vulnerability = loadVulnerability(cves, manual);
        const Klass = loadMeteorModule(subject.path, componentDeps(Vulnerability)).default;

        const doc = componentDoc();
        const component = new Klass(doc);
        expect(typeof component.findVulnerabilities).toBe('function');

        await component.findVulnerabilities(COMPANY);

        const found = doc.versions[0].vulnerabilities;
        expect(Array.isArray(found)).toBe(true);
        expect(found.map(function (v) { return v.name; })).toEqual(['CVE-2026-0001']);
        expect(found[0].affectedVersion).toBe(VERSION);
        expect(found[0].score).toBe('9.1');
        // The join actually ran - `cves` was queried for this key and version.
        expect(cves.calls).toHaveLength(1);
        expect(cves.calls[0].selector).toEqual({key: KEY, 'versions.version': {$in: [VERSION]}});
      });

      it('returns a promise, so a caller that forgets to await it is visible', function () {
        const Vulnerability = loadVulnerability(
          collectionOf([cveDoc(KEY, VERSION, 'CVE-2026-0001', 9.1)], cveMatches),
          collectionOf([], manualMatches));
        const Klass = loadMeteorModule(subject.path, componentDeps(Vulnerability)).default;
        const doc = componentDoc();
        const result = new Klass(doc).findVulnerabilities(COMPANY);
        expect(result && typeof result.then).toBe('function');
        return result;
      });

      it('picks up a company\'s manual vulnerabilities too', async function () {
        const manualDoc = {
          companyId: COMPANY,
          ecs: {value: KEY + ':' + VERSION, type: 'manual'},
          vuln: {name: 'MANUAL-1', description: 'reported by hand', severity: 'high'}
        };
        const Vulnerability = loadVulnerability(
          collectionOf([], cveMatches),
          collectionOf([manualDoc], manualMatches));
        const Klass = loadMeteorModule(subject.path, componentDeps(Vulnerability)).default;
        const doc = componentDoc();
        await new Klass(doc).findVulnerabilities(COMPANY);
        expect((doc.versions[0].vulnerabilities || []).map(function (v) { return v.name; }))
          .toEqual(['MANUAL-1']);
      });

      it('does not leak another company\'s manual vulnerability', async function () {
        const foreign = {
          companyId: 'company-other',
          ecs: {value: KEY + ':' + VERSION, type: 'manual'},
          vuln: {name: 'MANUAL-OTHER'}
        };
        const Vulnerability = loadVulnerability(
          collectionOf([], cveMatches),
          collectionOf([foreign], manualMatches));
        const Klass = loadMeteorModule(subject.path, componentDeps(Vulnerability)).default;
        const doc = componentDoc();
        await new Klass(doc).findVulnerabilities(COMPANY);
        expect(doc.versions[0].vulnerabilities).toBeUndefined();
      });
    });
  });
});

describe('#138 modules.getComponents awaits the join', function () {
  function loadGetComponents(componentsById, infrastructureById, scan) {
    const findOne = function (store) {
      return async function (selector) {
        const key = selector && (selector.key ||
          (selector.$or && selector.$or[0] && selector.$or[0].key));
        return store[key];
      };
    };
    return loadMeteorModule('imports/lib/interactors/modules/getComponents.js', {
      '/imports/lib/collections/components': {default: {findOneAsync: findOne(componentsById)}},
      '/imports/lib/collections/infrastructureComponents': {default: {findOneAsync: findOne(infrastructureById)}},
      '/imports/lib/collections/scans': {default: {findOneAsync: async function () { return scan; }}},
      'underscore': _
    }).default;
  }

  // A component whose join resolves on a later TASK, which is what a real cursor
  // read is. A microtask would not do: `data` is the same object the write lands
  // on, so awaiting getComponents at all would drain a microtask queue and the
  // assertion would hold even with the call left bare.
  function deferredComponent(doc) {
    return {
      data: function () { return doc; },
      findVulnerabilities: async function () {
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        doc.versions[0].vulnerabilities = [{name: 'CVE-2026-0001'}];
      },
      findVersion: function (version) {
        const match = (doc.versions || []).find(function (v) { return v.version === version; });
        return match ? {data: function () { return match; }} : undefined;
      }
    };
  }

  it('returns components whose versions already carry the findings', async function () {
    const doc = componentDoc();
    // `scan.dependencies[].versions` is `[String]` (imports/server/rest-api/
    // apiSchema.js), which is what getComponent's version filter compares against.
    const getComponents = loadGetComponents({[KEY]: deferredComponent(doc)}, {}, {
      dependencies: [{key: KEY, versions: [VERSION]}]
    });

    const components = await getComponents({_id: 'mod1', name: 'mod', companyId: COMPANY,
      getScanIdAsync: async function () { return 'scan1'; }});

    expect(components).toHaveLength(1);
    expect(components[0].versions[0].vulnerabilities)
      .toEqual([{name: 'CVE-2026-0001'}]);
  });

  it('resolves infrastructure components (`im:`) through the same path', async function () {
    const doc = {key: 'im:host', name: 'host', versions: [{version: VERSION}]};
    const getComponents = loadGetComponents({}, {'im:host': deferredComponent(doc)}, {
      dependencies: [{key: 'im:host', versions: [VERSION]}]
    });

    const components = await getComponents({_id: 'mod1', name: 'mod', companyId: COMPANY,
      getScanIdAsync: async function () { return 'scan1'; }});

    expect(components[0].versions[0].vulnerabilities)
      .toEqual([{name: 'CVE-2026-0001'}]);
  });
});

describe('#138 no server-only method reaches the synchronous helper', function () {
  SUBJECTS.forEach(function (subject) {
    it(`${subject.label} calls findAllAsync, never findAll`, function () {
      const source = readSourceWithoutComments(subject.path);
      expect(source).toContain('Vulnerability.findAllAsync(');
      // `findAllAsync(` also contains `findAll`, so the guard has to exclude it
      // explicitly rather than searching for the shorter name.
      expect(source).not.toMatch(/Vulnerability\.findAll\s*\(/);
    });
  });

  it('getComponents awaits the method rather than calling it bare', function () {
    const source = readSourceWithoutComments('imports/lib/interactors/modules/getComponents.js');
    expect(source).toMatch(/await\s+component\.findVulnerabilities\(/);
  });
});

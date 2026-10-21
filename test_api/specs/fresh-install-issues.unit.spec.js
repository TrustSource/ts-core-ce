/* eslint-disable no-undef */
// Fresh-installation regressions (GitHub issues #1, #2, #3) exercised against the REAL
// production modules, loaded with stubbed Meteor imports (helpers/loadMeteorModule).
// fresh-install-issues.source.unit.spec.js pins the wiring inside generateDemoData, which is
// too entangled with Meteor to load; this file covers the behaviour on both sides of it.
const _ = require('underscore');
const {loadMeteorModule} = require('../helpers/loadMeteorModule');

// Lets every settled promise run its handlers. A setImmediate callback runs after the whole
// microtask queue has drained, so no timing is involved.
function flushPromises() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// ---------------------------------------------------------------------------------------
// #3 - riskProperties startup: dropping the stale index on a fresh database
// ---------------------------------------------------------------------------------------
describe('riskProperties startup drops the stale autoKey index quietly (#3)', () => {
  const STALE_LOG = 'riskProperties: stale global autoKey index could not be dropped -';

  // Runs the real Meteor.startup hook of imports/server/collections/riskProperties.js with a
  // raw collection whose dropIndex rejects with `rejection`.
  async function runStartup(rejection) {
    let startupHook = null;
    const raw = {
      createIndexCalls: [],
      dropIndexCalls: [],
      createIndex: function () {
        raw.createIndexCalls.push(Array.prototype.slice.call(arguments));
        return Promise.resolve('ok');
      },
      dropIndex: function (name) {
        raw.dropIndexCalls.push(name);
        return Promise.reject(rejection);
      }
    };
    const exported = loadMeteorModule('imports/server/collections/riskProperties.js', {
      'meteor/meteor': {Meteor: {
        publish: function () {},
        startup: function (fn) { startupHook = fn; },
        users: {findOneAsync: async function () { return null; }}
      }},
      '/imports/lib/collections/riskProperties': {default: {deny: function () {}, find: function () {}}},
      '/imports/server/ServerUtils': {default: {makeRawCollection: function () { return raw; }}}
    });
    expect(typeof startupHook).toBe('function');
    startupHook();
    await flushPromises();
    return {raw, exported};
  }

  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(function () {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  function staleIndexLogs() {
    return errorSpy.mock.calls.filter(function (call) { return call[0] === STALE_LOG; });
  }

  function mongoError(code, codeName, message) {
    const error = new Error(message);
    error.code = code;
    error.codeName = codeName;
    return error;
  }

  // What the driver raises for dropIndexes on a database that has never held a risk - the
  // fresh-install case behind #3 - and on one that simply never had the old index.
  it.each([
    ['NamespaceNotFound (26) on a fresh database', mongoError(26, 'NamespaceNotFound', 'ns not found')],
    ['NamespaceNotFound (26) with a server-specific message', mongoError(26, 'NamespaceNotFound', 'ns does not exist: ts.riskProperties')],
    ['an "ns not found" message without a code', new Error('ns not found')],
    ['IndexNotFound (27)', mongoError(27, 'IndexNotFound', 'index not found with name [riskProperties_autoKey_unique]')],
    ['an "index not found" message without a code', new Error('Index not found with name [riskProperties_autoKey_unique]')]
  ])('stays silent for %s', async (_label, rejection) => {
    const {raw} = await runStartup(rejection);
    // Positive control: the drop really ran and really rejected - silence is not because the
    // hook never got that far.
    expect(raw.dropIndexCalls).toEqual(['riskProperties_autoKey_unique']);
    expect(staleIndexLogs()).toEqual([]);
  });

  // The other direction: a real failure must still reach the task log, or a stale
  // cross-tenant unique index could survive every deploy unnoticed.
  it.each([
    ['Unauthorized (13)', mongoError(13, 'Unauthorized', 'not authorized on ts to execute command { dropIndexes: "riskProperties" }')],
    ['a network error', mongoError(undefined, undefined, 'connection 1 to 127.0.0.1:27017 closed')],
    ['MaxTimeMSExpired (50)', mongoError(50, 'MaxTimeMSExpired', 'operation exceeded time limit')],
    ['a rejection without an error object', undefined]
  ])('still logs %s', async (_label, rejection) => {
    const {raw} = await runStartup(rejection);
    expect(raw.dropIndexCalls).toEqual(['riskProperties_autoKey_unique']);
    const logs = staleIndexLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toEqual(rejection && rejection.message);
  });

  it('a swallowed rejection does not escape as an unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = function (reason) { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await runStartup(mongoError(26, 'NamespaceNotFound', 'ns not found'));
      await flushPromises();
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// #1, #2 - the demo scan reaches processScan and lands on the demo module
// ---------------------------------------------------------------------------------------
// processScan(scanId, user, companyId, demo) reads the scan by {_id: scanId, companyId} and
// resolves its module through Utils.findOrCreateModuleByCompanyIdAndName(companyId,
// scan.module, scan.moduleIdentifier, scan.projectId, ...). These tests run the real
// DemoData.getDemoScan and the real resolver against an in-memory Modules collection.

function matches(doc, selector) {
  return Object.keys(selector).every(function (key) {
    const value = selector[key];
    if (key === '$and') { return value.every(function (sub) { return matches(doc, sub); }); }
    if (key === '$or') { return value.some(function (sub) { return matches(doc, sub); }); }
    return doc[key] === value;
  });
}

function fakeCollection(docs, name) {
  const state = {docs: docs || [], updates: [], inserted: []};
  return {
    state: state,
    find: function (selector, options) {
      let found = state.docs.filter(function (doc) { return matches(doc, selector); });
      if (options && options.limit) { found = found.slice(0, options.limit); }
      return {fetchAsync: async function () { return found; }};
    },
    findOneAsync: async function (selector) {
      // Meteor rewrites a falsy selector to one that matches nothing.
      if (!selector) { return null; }
      const query = typeof selector === 'string' ? {_id: selector} : selector;
      return state.docs.filter(function (doc) { return matches(doc, query); })[0] || null;
    },
    updateAsync: async function (id, modifier) { state.updates.push({id: id, modifier: modifier}); },
    insertAsync: async function (doc) {
      const id = `${name}_${state.inserted.length + 1}`;
      state.inserted.push(Object.assign({_id: id}, doc));
      state.docs.push(Object.assign({_id: id}, doc));
      return id;
    }
  };
}

function loadUtils(modules, projects) {
  const noop = function () {};
  return loadMeteorModule('imports/lib/utils.js', {
    'meteor/meteor': {Meteor: {isServer: true, isClient: false, isCordova: false,
      startup: noop, callAsync: async function () {}, settings: {}}},
    'meteor/session': {Session: {get: noop, set: noop}},
    'packageurl-js': {PackageURL: function () {}},
    'underscore': _,
    '/imports/lib/component/Component': {default: function () {}},
    '/imports/lib/component/License': {default: function () {}},
    '/imports/lib/component/packageTypes': {ALLOWED_PACKAGE_TYPES: ['npm', 'maven']},
    '/imports/lib/sarif/runStatus': require('../../imports/lib/sarif/runStatus'),
    '/imports/lib/analysis/pathLocation': require('../../imports/lib/analysis/pathLocation'),
    '/imports/lib/collections/projects': {default: projects},
    '/imports/lib/collections/constraints': {default: {}},
    '/imports/lib/collections/rules': {default: {}},
    './collections/modules': {default: modules},
    './project/Module': {default: function Module(companyId, name, moduleIdentifier, projectId, demo) {
      this.companyId = companyId;
      this.name = name;
      this.moduleIdentifier = moduleIdentifier;
      this.projectId = projectId;
      this.demo = demo;
    }}
  }).default;
}

const DemoData = loadMeteorModule('imports/lib/demo/demoData.js', {}).default;

describe('the demo scan is processed into the demo module (#1, #2)', () => {
  const COMPANY = 'company-demo';
  const PROJECT = 'project-demo';
  const SCAN_ID = 'scan-demo';
  const USER = {_id: 'user-1', profile: {companyId: COMPANY, email: 'demo@example.org'}};

  // What generateDemoData stores before it calls processScan: one project, and one module
  // named 'Demo module' whose identifier comes from Utils.generateModuleIdentifier.
  function seed() {
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY, name: 'Demo project'}], 'project');
    const modules = fakeCollection([], 'module');
    const Utils = loadUtils(modules, projects);
    const demoModule = {_id: 'module-demo', companyId: COMPANY, projectId: PROJECT, demo: true,
      name: 'Demo module', moduleIdentifier: Utils.generateModuleIdentifier('Demo module')};
    modules.state.docs.push(demoModule);
    return {Utils, modules, demoModule};
  }

  function resolve(Utils, scan) {
    return Utils.findOrCreateModuleByCompanyIdAndName(
      COMPANY, scan.module, scan.moduleIdentifier, scan.projectId, USER, true);
  }

  it('processScan can find the stored demo scan by the id and company it is given', () => {
    const scan = DemoData.getDemoScan(SCAN_ID, 'module-demo', USER);
    // processScan's own lookup, with the companyId generateDemoData hands it
    // (user3.profile.companyId of the signed-in user).
    expect(matches(scan, {_id: SCAN_ID, companyId: USER.profile.companyId})).toBe(true);
    expect(scan.demo).toBe(true);
    expect(scan.module).toBe('Demo module');
    // Something for processScan to put into the component catalogue.
    expect(scan.dependencies.length).toBeGreaterThan(0);
  });

  it('with the module\'s projectId and identifier, the scan resolves to the existing demo module', async () => {
    const {Utils, modules, demoModule} = seed();
    const scan = DemoData.getDemoScan(SCAN_ID, demoModule._id, USER);
    scan.projectId = PROJECT;
    scan.moduleIdentifier = demoModule.moduleIdentifier;

    const module = await resolve(Utils, scan);

    expect(module._id).toBe(demoModule._id);
    expect(modules.state.inserted).toEqual([]);
  });

  // The control that makes the assignment in generateDemoData load-bearing: getDemoScan's own
  // fields do not identify the module generateDemoData created, so processing the raw demo
  // scan would build a second module beside the demo one. If getDemoScan is ever changed to
  // carry matching fields this test fails and the override can be reconsidered.
  it('without them, the raw demo scan would create a second module', async () => {
    const {Utils, modules, demoModule} = seed();
    const scan = DemoData.getDemoScan(SCAN_ID, demoModule._id, USER);
    expect(scan.projectId).toBeUndefined();
    expect(scan.moduleIdentifier).not.toEqual(demoModule.moduleIdentifier);

    const module = await resolve(Utils, scan);

    expect(module._id).not.toBe(demoModule._id);
    expect(modules.state.inserted).toHaveLength(1);
    expect(modules.state.inserted[0].demo).toBe(true);
  });

  it('does not match a same-named module of another project of the company', async () => {
    const {Utils, modules, demoModule} = seed();
    // An earlier demo load (or a user module) named 'Demo module' in a different project.
    modules.state.docs.unshift({_id: 'module-other', companyId: COMPANY, projectId: 'project-other',
      name: 'Demo module', moduleIdentifier: demoModule.moduleIdentifier});
    const scan = DemoData.getDemoScan(SCAN_ID, demoModule._id, USER);
    scan.projectId = PROJECT;
    scan.moduleIdentifier = demoModule.moduleIdentifier;

    const module = await resolve(Utils, scan);

    expect(module._id).toBe(demoModule._id);
    expect(modules.state.inserted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// #3 - the client never asks the server to set a locale before sign-in
// ---------------------------------------------------------------------------------------
// Runs the real imports/startup/client/index.js. The i18n stub reproduces the two places
// universe:i18n@3.0.1 (the version in .meteor/versions) consults the option -
// _loadLocaleWithAncestors via setLocale, and the DDP stream 'reset' handler - and its
// setOptions, which merges (Object.assign) rather than replaces.
describe('client startup never calls setServerLocaleForConnection (#3)', () => {
  function runClientStartup(user) {
    const calls = [];
    const autoruns = [];
    const resetHandlers = [];
    const i18n = {
      options: {sameLocaleOnServerConnection: true, defaultLocale: 'en-US'},
      _locale: 'en-US',
      setOptions: function (options) { Object.assign(i18n.options, options); },
      setLocale: function (locale) {
        if (i18n.options.sameLocaleOnServerConnection) {
          calls.push(['universe.i18n.setServerLocaleForConnection', locale]);
        }
        i18n._locale = locale;
      }
    };
    // The package's own 'reset' handler, registered when the package loads.
    resetHandlers.push(function () {
      if (i18n.options.sameLocaleOnServerConnection && i18n._locale) {
        calls.push(['universe.i18n.setServerLocaleForConnection', i18n._locale]);
      }
    });
    const chain = {on: function () { return chain; }, each: function () { return chain; }, length: 0};
    const noop = function () {};
    loadMeteorModule('imports/startup/client/index.js', {
      'underscore': _,
      'meteor/meteor': {Meteor: {user: function () { return user; }, subscribe: noop, startup: noop,
        defer: noop, call: function () { calls.push(Array.prototype.slice.call(arguments)); }}},
      'meteor/tracker': {Tracker: {autorun: function (fn) { autoruns.push(fn); fn(); }}},
      'meteor/jquery': {$: function () { return chain; }},
      'meteor/vlasky:galvanized-iron-router': {Router: {onStop: noop}},
      'meteor/universe:i18n': {default: i18n},
      'meteor/communitypackages:autoform-bootstrap3/static': {AutoFormThemeBootstrap3: {load: noop}},
      'meteor/aldeed:autoform': {AutoForm: {setDefaultTemplate: noop, Utility: {getComponentContext: noop},
        getFormSchema: noop}},
      'meteor/templating': {Template: {}}
    }, {allowNoExports: true, globals: {window: {}, document: {body: {}}, CSS: {escape: String}}});
    return {calls, autoruns, i18n, reconnect: function () { resetHandlers.forEach(function (fn) { fn(); }); }};
  }

  it('signed out: no locale call on load or on reconnect', () => {
    const run = runClientStartup(null);
    expect(run.autoruns).toHaveLength(1);
    run.reconnect();
    expect(run.calls).toEqual([]);
    expect(run.i18n.options.sameLocaleOnServerConnection).toBe(false);
    // The signed-out branch's own setOptions must not undo the flag.
    expect(run.i18n.options.defaultLocale).toBe('en');
  });

  it('signed in with a language: the locale is applied client-side only', () => {
    const run = runClientStartup({_id: 'u1', profile: {lang: 'de'}});
    run.reconnect();
    expect(run.i18n._locale).toBe('de');
    expect(run.calls).toEqual([]);
  });

  // Control: the stub does reach the server call when the option is left on, so the two
  // empty `calls` above are a result of the startup code, not of a stub that never calls.
  it('control: with the option left on, the same flow would make the call', () => {
    const run = runClientStartup({_id: 'u1', profile: {lang: 'de'}});
    run.i18n.setOptions({sameLocaleOnServerConnection: true});
    run.reconnect();
    expect(run.calls).toEqual([['universe.i18n.setServerLocaleForConnection', 'de']]);
  });
});

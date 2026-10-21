/* eslint-disable no-undef */
// A dependency scan (POST /scans), an SBOM import (POST /imports/scan/*) and a
// SARIF upload (POST /tests/sarif) derive `moduleIdentifier` from three different functions,
// so the same component arrived as `npm:admin-panel`, `admin-panel` or `AdminPanel` depending
// on the endpoint. Matching on the identifier alone made whichever upload landed second miss
// the module the first one had created and build a duplicate beside it - one row carrying the
// dependencies, the other the test findings.
//
// Both halves of the fix are exercised here against the REAL production source (loaded with
// stubbed Meteor imports, see helpers/loadMeteorModule): the name fallback inside
// findOrCreateModuleByCompanyIdAndName, and the precedence order in resolveModuleRef.
const {loadMeteorModule} = require('../helpers/loadMeteorModule');
// Loaded for real rather than stubbed - the resolver trims the name it is asked for since the
// idempotent-create follow-up, and a stub that always agreed would hide that. project-name-normalization.
// unit.spec.js owns the trim's own assertions.
const projectNameModule = loadMeteorModule('imports/lib/project/projectName.js', {});
const _ = require('underscore');

// --- a minimal in-memory Mongo -------------------------------------------------------
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

// --- the real Utils, with Meteor swapped out ------------------------------------------
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
    // meteor-free already, so the real module goes in rather than a stub
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

const COMPANY = 'company-1';
const PROJECT = 'project-1';

function scanModule() {   // what a ts-scan upload creates: a NAMESPACED identifier
  return {_id: 'm-scan', companyId: COMPANY, projectId: PROJECT,
    name: 'admin-panel', moduleIdentifier: 'npm:admin-panel'};
}

function sarifModule() {  // what a SARIF upload creates: the identifier derived from the name
  return {_id: 'm-sarif', companyId: COMPANY, projectId: PROJECT,
    name: 'admin-panel', moduleIdentifier: 'admin-panel'};
}

describe('findOrCreateModuleByCompanyIdAndName matches on the module name (issue #119)', () => {
  it('a scan finds the module a SARIF upload created, despite the namespaced identifier', async () => {
    const modules = fakeCollection([sarifModule()], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    const Utils = loadUtils(modules, projects);

    const module = await Utils.findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'npm:admin-panel', PROJECT, {}, undefined);

    expect(module._id).toEqual('m-sarif');
    expect(modules.state.inserted.length).toEqual(0);
  });

  it('a SARIF upload finds the module a scan created - the other arrival order', async () => {
    const modules = fakeCollection([scanModule()], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    const Utils = loadUtils(modules, projects);

    const module = await Utils.findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'admin-panel', PROJECT, {}, undefined);

    expect(module._id).toEqual('m-scan');
    expect(modules.state.inserted.length).toEqual(0);
  });

  it('the identifier still wins when it matches - the name is only a fallback', async () => {
    const modules = fakeCollection([
      scanModule(),
      {_id: 'm-other', companyId: COMPANY, projectId: PROJECT,
        name: 'admin-panel', moduleIdentifier: 'maven:admin-panel'}
    ], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    const Utils = loadUtils(modules, projects);

    const module = await Utils.findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'maven:admin-panel', PROJECT, {}, undefined);

    expect(module._id).toEqual('m-other');
  });

  it('refuses to guess when one name covers two modules, instead of merging them silently', async () => {
    // A polyglot repository may legitimately hold npm: and maven: modules under one display
    // name. Picking either would attach the upload to an arbitrary one of them.
    const modules = fakeCollection([
      scanModule(),
      {_id: 'm-maven', companyId: COMPANY, projectId: PROJECT,
        name: 'admin-panel', moduleIdentifier: 'maven:admin-panel'}
    ], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    const Utils = loadUtils(modules, projects);
    const errors = [];
    const realError = console.error;
    console.error = function () { errors.push(Array.prototype.join.call(arguments, ' ')); };

    let module;
    try {
      module = await Utils.findOrCreateModuleByCompanyIdAndName(
        COMPANY, 'admin-panel', 'pypi:admin-panel', PROJECT, {}, undefined);
    } finally {
      console.error = realError;
    }

    expect(['m-scan', 'm-maven']).not.toContain(module._id);
    expect(modules.state.inserted.length).toEqual(1);
    expect(errors.join(' ')).toMatch(/ambiguous/);
  });

  it('never matches a same-named module in another project or another company', async () => {
    const modules = fakeCollection([
      {_id: 'm-other-project', companyId: COMPANY, projectId: 'project-2',
        name: 'admin-panel', moduleIdentifier: 'admin-panel'},
      {_id: 'm-other-company', companyId: 'company-2', projectId: PROJECT,
        name: 'admin-panel', moduleIdentifier: 'admin-panel'}
    ], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    const Utils = loadUtils(modules, projects);

    const module = await Utils.findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'npm:admin-panel', PROJECT, {}, undefined);

    expect(module._id).toEqual('module_1');           // freshly created
    expect(modules.state.inserted.length).toEqual(1);
  });

  it('stamps a matched module as scanned, unless the caller says it carries no scan', async () => {
    const withScan = fakeCollection([sarifModule()], 'module');
    const projects = fakeCollection([{_id: PROJECT, companyId: COMPANY}], 'project');
    await loadUtils(withScan, projects).findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'npm:admin-panel', PROJECT, {}, undefined);
    expect(withScan.state.updates.length).toEqual(1);
    expect(withScan.state.updates[0].modifier.$set.scanned).toBeInstanceOf(Date);

    // A SARIF document is not a dependency scan: stamping it would make the module list
    // report the analysis as outdated (scanned > analyzed).
    const withoutScan = fakeCollection([scanModule()], 'module');
    await loadUtils(withoutScan, projects).findOrCreateModuleByCompanyIdAndName(
      COMPANY, 'admin-panel', 'admin-panel', PROJECT, {}, undefined, false);
    expect(withoutScan.state.updates.length).toEqual(0);
  });
});

// --- the shared resolver ---------------------------------------------------------------
const asStringStub = {asString: function (v) {
  return typeof v === 'string' ? v : undefined;
}};

function loadResolver({modules, projects, scans, analyses, utils}) {
  return loadMeteorModule('imports/server/rest-api/moduleResolver.js', {
    '/imports/lib/collections/modules': {default: modules},
    '/imports/lib/collections/projects': {default: projects},
    '/imports/lib/collections/scans': {default: scans || fakeCollection([], 'scan')},
    '/imports/lib/collections/moduleAnalysis': {default: analyses || fakeCollection([], 'analysis')},
    '/imports/lib/utils': {default: utils},
    // The REAL project resolver, over the same fake collection, so the name arm
    // of resolveProjectRef is exercised rather than replaced by a stub that always agrees.
    './projectResolver': loadMeteorModule('imports/server/rest-api/projectResolver.js', {
      '/imports/lib/collections/projects': {default: projects},
      '/imports/lib/security/sanitizeQuery': asStringStub,
      '/imports/lib/project/projectName': projectNameModule
    }),
    '/imports/lib/security/sanitizeQuery': asStringStub
  });
}

function recordingUtils(returnedModule) {
  const calls = [];
  return {
    calls: calls,
    findOrCreateModuleByCompanyIdAndName: async function () {
      calls.push(Array.prototype.slice.call(arguments));
      return returnedModule;
    }
  };
}

describe('resolveModuleRef precedence (issue #119)', () => {
  const project = {_id: PROJECT, companyId: COMPANY, name: 'Storefront'};

  it('an explicit moduleId wins over the names', async () => {
    const utils = recordingUtils(null);
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([scanModule()], 'module'),
      projects: fakeCollection([project], 'project'),
      utils: utils
    });

    const result = await resolveModuleRef({companyId: COMPANY, moduleId: 'm-scan',
      projectName: 'Storefront', moduleName: 'something-else', create: true});

    expect(result.moduleId).toEqual('m-scan');
    expect(result.project.name).toEqual('Storefront');
    expect(utils.calls.length).toEqual(0);            // no name resolution, no creation
  });

  it('a foreign moduleId is passed through, so the write path can still refuse it', async () => {
    // Swallowing it here would turn testImports/create.js's 403 into a silent success.
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([], 'module'),
      projects: fakeCollection([project], 'project'),
      utils: recordingUtils(null)
    });

    const result = await resolveModuleRef({companyId: COMPANY, moduleId: 'someone-elses-module'});

    expect(result.moduleId).toEqual('someone-elses-module');
    expect(result.module).toBeNull();
  });

  it('resolves a scanId to its module, only inside the caller\'s company', async () => {
    const scans = fakeCollection([
      {_id: 'scan-1', companyId: COMPANY, moduleId: 'm-scan'},
      {_id: 'scan-2', companyId: 'company-2', moduleId: 'm-foreign'}
    ], 'scan');
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([scanModule()], 'module'),
      projects: fakeCollection([project], 'project'),
      scans: scans,
      utils: recordingUtils(null)
    });

    const own = await resolveModuleRef({companyId: COMPANY, scanId: 'scan-1'});
    expect(own.moduleId).toEqual('m-scan');

    const foreign = await resolveModuleRef({companyId: COMPANY, scanId: 'scan-2'});
    expect(foreign.moduleId).toBeFalsy();
  });

  it('resolves an analysisId to both the module and the scan', async () => {
    const analyses = fakeCollection([
      {_id: 'analysis-1', companyId: COMPANY, moduleId: 'm-scan', scanId: 'scan-1'}
    ], 'analysis');
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([scanModule()], 'module'),
      projects: fakeCollection([project], 'project'),
      analyses: analyses,
      utils: recordingUtils(null)
    });

    const result = await resolveModuleRef({companyId: COMPANY, analysisId: 'analysis-1'});

    expect(result.moduleId).toEqual('m-scan');
    expect(result.scanId).toEqual('scan-1');
  });

  it('resolves a name inside the project, passing the identifier through untouched', async () => {
    const utils = recordingUtils(scanModule());
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([scanModule()], 'module'),
      projects: fakeCollection([project], 'project'),
      utils: utils
    });

    const result = await resolveModuleRef({companyId: COMPANY, user: {_id: 'u1'},
      projectName: 'Storefront', moduleName: 'admin-panel',
      moduleIdentifier: 'npm:admin-panel', create: true});

    expect(result.moduleId).toEqual('m-scan');
    expect(utils.calls[0].slice(0, 4)).toEqual([COMPANY, 'admin-panel', 'npm:admin-panel', PROJECT]);
  });

  it('reports an unknown project as 404 instead of creating one', async () => {
    const utils = recordingUtils(null);
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([], 'module'),
      projects: fakeCollection([project], 'project'),
      utils: utils
    });

    const result = await resolveModuleRef({companyId: COMPANY, projectName: 'No Such Project',
      moduleName: 'admin-panel', create: true});

    expect(result.error.statusCode).toEqual(404);
    expect(utils.calls.length).toEqual(0);
  });

  it('matches a bare module name company-wide only when the caller allows it', async () => {
    const modules = fakeCollection([sarifModule()], 'module');
    const projects = fakeCollection([project], 'project');
    const {resolveModuleRef} = loadResolver({modules, projects, utils: recordingUtils(null)});

    const off = await resolveModuleRef({companyId: COMPANY, moduleName: 'admin-panel'});
    expect(off.moduleId).toBeFalsy();

    const on = await resolveModuleRef({companyId: COMPANY, moduleName: 'admin-panel',
      allowCompanyWideNameMatch: true});
    expect(on.moduleId).toEqual('m-sarif');
    expect(on.project.name).toEqual('Storefront');
  });

  it('does not create anything when the caller did not ask for it', async () => {
    const utils = recordingUtils(null);
    const {resolveModuleRef} = loadResolver({
      modules: fakeCollection([], 'module'),
      projects: fakeCollection([project], 'project'),
      utils: utils
    });

    const result = await resolveModuleRef({companyId: COMPANY, projectName: 'Storefront',
      moduleName: 'admin-panel'});

    expect(result.module).toBeFalsy();
    expect(utils.calls.length).toEqual(0);
  });
});

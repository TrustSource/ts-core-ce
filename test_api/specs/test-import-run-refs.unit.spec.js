/* eslint-disable no-undef */
// A SARIF test run may only name an analysis and scan of the caller's company (and of
// the module it names). runRefs.js imports Meteor collections, so the function is
// lifted out of the source and run against stub collections.
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const SRC = read('imports/lib/interactors/testImports/runRefs.js');

const body = SRC.slice(SRC.indexOf('export async function runRefsBelongTo')).replace(/^export /, '');
const build = new Function('ModuleAnalysis', 'Scans', `${body}\nreturn runRefsBelongTo;`);

function stub(docs) {
  return {
    findOneAsync: async (selector) => docs.find((doc) =>
      Object.keys(selector).every((key) => doc[key] === selector[key])) || null
  };
}

const analyses = stub([
  {_id: 'a-own', companyId: 'c1', moduleId: 'm1'},
  {_id: 'a-other-module', companyId: 'c1', moduleId: 'm2'},
  {_id: 'a-foreign', companyId: 'c2', moduleId: 'm9'}
]);
const scans = stub([
  {_id: 's-own', companyId: 'c1', moduleId: 'm1'},
  {_id: 's-foreign', companyId: 'c2', moduleId: 'm9'}
]);
const runRefsBelongTo = build(analyses, scans);

describe('runRefsBelongTo', () => {
  it('accepts a run without analysis or scan', async () => {
    expect(await runRefsBelongTo({companyId: 'c1', moduleId: 'm1'})).toBe(true);
  });

  it('accepts the analysis and scan of the same company and module', async () => {
    expect(await runRefsBelongTo({companyId: 'c1', moduleId: 'm1', analysisId: 'a-own', scanId: 's-own'})).toBe(true);
  });

  it('refuses another company\'s analysis or scan', async () => {
    expect(await runRefsBelongTo({companyId: 'c1', moduleId: 'm1', analysisId: 'a-foreign'})).toBe(false);
    expect(await runRefsBelongTo({companyId: 'c1', moduleId: 'm1', scanId: 's-foreign'})).toBe(false);
    expect(await runRefsBelongTo({companyId: 'c1', analysisId: 'a-foreign'})).toBe(false);
  });

  it('refuses an analysis of another module of the same company', async () => {
    expect(await runRefsBelongTo({companyId: 'c1', moduleId: 'm1', analysisId: 'a-other-module'})).toBe(false);
  });

  it('refuses non-string ids and a missing company', async () => {
    expect(await runRefsBelongTo({companyId: 'c1', scanId: {$ne: null}})).toBe(false);
    expect(await runRefsBelongTo({companyId: undefined})).toBe(false);
  });
});

describe('where the check runs', () => {
  it('runs in the import code on the server, which the REST endpoint uses', () => {
    expect(read('imports/lib/interactors/testImports/create.js'))
      .toMatch(/Meteor\.isServer && !await runRefsBelongTo\(\{companyId: companyIdentifier, moduleId, analysisId, scanId\}\)/);
  });

  it('runs in the Tests insert rule used by the browser import', () => {
    expect(read('imports/server/collections/tests.js'))
      .toMatch(/runRefsBelongTo\(\{companyId, moduleId: doc\.moduleId, analysisId: doc\.analysisId, scanId: doc\.scanId\}\)/);
  });

  it('answers a refused REST import with 403', () => {
    expect(read('imports/server/rest-api/tests.js')).toMatch(/error\.error === 403\) \{\s*response\.statusCode = 403;/);
  });
});

import {Meteor} from 'meteor/meteor';
import {expect} from 'chai';
import sinon from 'sinon';
import ModuleAnalysis from '/imports/lib/collections/moduleAnalysis';
import {redirectToModulePage} from './appLinkRedirect';

// The link ts-scan prints after --wait-for-analysis (#35).
describe('REST: ts-scan result link redirect (#35)', function () {
  function response() {
    return {
      writeHead(status, headers) { this.status = status; this.headers = headers || {}; },
      end() { this.ended = true; }
    };
  }

  afterEach(function () {
    sinon.restore();
  });

  it('redirects to the module page with the analysis of the scan', async function () {
    sinon.stub(ModuleAnalysis, 'findOneAsync').resolves({_id: 'analysis12345'});
    const res = response();
    await redirectToModulePage({projectId: 'proj1', moduleId: 'mod1', query: {analysis: 'scan1'}}, res);
    expect(res.status).to.equal(302);
    expect(res.headers.Location).to.equal(
      Meteor.absoluteUrl('projects/proj1/modules/mod1/dependencies?analysis=analysis12345'));
  });

  it('redirects without an analysis when the scan has none', async function () {
    sinon.stub(ModuleAnalysis, 'findOneAsync').resolves(undefined);
    const res = response();
    await redirectToModulePage({projectId: 'proj1', moduleId: 'mod1', query: {analysis: 'scan1'}}, res);
    expect(res.headers.Location).to.equal(Meteor.absoluteUrl('projects/proj1/modules/mod1/dependencies'));
  });

  it('answers 404 for ids that are not ids', async function () {
    const res = response();
    await redirectToModulePage({projectId: '../x', moduleId: 'mod1', query: {}}, res);
    expect(res.status).to.equal(404);
  });
});

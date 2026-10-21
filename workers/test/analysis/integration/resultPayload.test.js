import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analysisResultSummary } from '../../../analysis/index.js';

// run() answers with analysisResultSummary() rather than the full analysis: ts-app
// returns it to the caller and sends it with the `analysis` webhook, and reads the
// full document from the analysis collection when it needs components[] or licenses[].

function fullResult() {
  return {
    _id: 'analysis-1',
    date: new Date('2026-08-11T09:37:16.445Z'),
    scanId: 'scan-1',
    companyId: 'company-1',
    moduleId: 'module-1',
    branch: 'main',
    tag: null,
    release: null,
    latest: true,
    rootComponentsCount: 1,
    statistics: {components: 51, licenses: 7},
    components: [{key: 'npm:left-pad'}, {key: 'npm:right-pad'}],
    licenses: [{key: 'MIT'}]
  };
}

describe('analysis result payload', () => {
  it('summary keeps the identifying fields', () => {
    const summary = analysisResultSummary(fullResult());
    assert.equal(summary._id, 'analysis-1');
    assert.equal(summary.scanId, 'scan-1');
    assert.equal(summary.moduleId, 'module-1');
    assert.equal(summary.latest, true);
    assert.equal(summary.rootComponentsCount, 1);
    assert.deepEqual(summary.statistics, {components: 51, licenses: 7});
  });

  it('summary drops the component and license arrays', () => {
    const summary = analysisResultSummary(fullResult());
    assert.equal(summary.components, undefined);
    assert.equal(summary.licenses, undefined);
    assert.deepEqual(Object.keys(summary).sort(), [
      '_id', 'branch', 'companyId', 'date', 'latest', 'moduleId',
      'release', 'rootComponentsCount', 'scanId', 'statistics', 'tag'
    ]);
  });

  it('leaves non-objects untouched', () => {
    assert.equal(analysisResultSummary(null), null);
    assert.equal(analysisResultSummary(undefined), undefined);
    assert.equal(analysisResultSummary('error string'), 'error string');
  });
});

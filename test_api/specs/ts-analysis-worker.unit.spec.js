/* eslint-disable no-undef */
// Module analysis runs in the analysis worker (workers/analysis). tsAnalyze hands it the
// input, analyzeModule sends the `analysis` webhook the Lambda used to send, and a run
// that died leaves no module stuck on "Analysis in progress ...".
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

class MeteorError extends Error {
  constructor(error, reason) {
    super(reason ? reason + ' [' + error + ']' : String(error));
    this.error = error;
    this.reason = reason;
    this.errorType = 'Meteor.Error';
  }
}

function loadTsAnalysis(options) {
  const opts = options || {};
  const calls = {worker: [], webhook: [], update: []};
  const module = loadMeteorModule('imports/startup/server/ts-analysis.js', {
    'meteor/meteor': {Meteor: {Error: MeteorError}},
    '/imports/lib/collections/modules': {default: {
      updateAsync: async function (selector, modifier) {
        calls.update.push({selector: selector, modifier: modifier});
        if (opts.updateError) {
          throw opts.updateError;
        }
        return 1;
      }
    }},
    '/imports/server/workerRunner': {runWorker: async function (service, input) {
      calls.worker.push({service: service, input: input});
      if (opts.workerError) {
        throw opts.workerError;
      }
      return opts.outcome;
    }},
    '/imports/startup/server/ts-webhook': {tsWebhook: async function (payload) {
      calls.webhook.push(payload);
      if (opts.webhookError) {
        throw opts.webhookError;
      }
      return [];
    }}
  });
  return {api: module, calls: calls};
}

function quietly(fn) {
  const original = console.info;
  console.info = function () {};
  return Promise.resolve().then(fn).finally(function () {
    console.info = original;
  });
}

const OUTCOME = {summary: {_id: 'a1', moduleId: 'm1'}, projectId: 'p1', projectName: 'Payments', moduleName: 'api'};

describe('tsAnalyze', () => {
  it('runs the analysis worker with the input and answers with its outcome', async () => {
    const {api, calls} = loadTsAnalysis({outcome: OUTCOME});
    const input = {companyId: 'c1', moduleId: 'm1', userId: 'u1', user: {_id: 'u1'}, scanId: 's1'};

    expect(await api.tsAnalyze(input)).toEqual(OUTCOME);
    expect(calls.worker).toEqual([{service: 'analysis', input: input}]);
  });

  it('turns a worker failure into a ts-analysis Meteor.Error', async () => {
    const {api} = loadTsAnalysis({workerError: Object.assign(new Error('404 Module m1 was not found'), {code: 404})});

    await quietly(() => expect(api.tsAnalyze({companyId: 'c1', moduleId: 'm1'}))
      .rejects.toMatchObject({error: 'ts-analysis', reason: '404 Module m1 was not found', errorType: 'Meteor.Error'}));
  });
});

describe('sendAnalysisWebhook', () => {
  it('sends the analysis trigger with the summary, as the Lambda did', async () => {
    const {api, calls} = loadTsAnalysis();

    await api.sendAnalysisWebhook('c1', OUTCOME);

    expect(calls.webhook).toEqual([{
      companyId: 'c1', projectId: 'p1', projectName: 'Payments', moduleName: 'api',
      trigger: 'analysis', data: {_id: 'a1', moduleId: 'm1'}
    }]);
  });

  it('never fails the analysis', async () => {
    const {api} = loadTsAnalysis({webhookError: new Error('boom')});

    await quietly(() => expect(api.sendAnalysisWebhook('c1', OUTCOME)).resolves.toBeUndefined());
  });
});

describe('releaseAnalysisStatus', () => {
  it('moves only an in-progress status to finished', async () => {
    const {api, calls} = loadTsAnalysis();

    await api.releaseAnalysisStatus('m1', 'c1');

    expect(calls.update).toEqual([{
      selector: {_id: 'm1', companyId: 'c1', status: 'Analysis in progress ...'},
      modifier: {$set: {status: 'Analysis finished'}}
    }]);
  });

  it('never throws', async () => {
    const {api} = loadTsAnalysis({updateError: new Error('db down')});

    await quietly(() => expect(api.releaseAnalysisStatus('m1', 'c1')).resolves.toBeUndefined());
  });
});

describe('analyzeModule', () => {
  const source = readSourceWithoutComments('imports/server/collections/modules.js');
  const method = source.slice(source.indexOf('analyzeModule: async function'),
    source.indexOf('analyzeAllModules: async function'));

  it('has no development-only branch left', () => {
    expect(method).not.toMatch(/NODE_ENV|rawData|returnFullResult|ModuleAnalysis\.insertAsync/);
  });

  it('refuses ids that are not strings before anything else', () => {
    expect(method).toMatch(/typeof moduleId !== 'string'/);
    expect(method.indexOf("typeof moduleId !== 'string'")).toBeLessThan(method.indexOf('resolveActingUser'));
  });

  it('runs the worker, sends the webhook on a summary, and releases the status on failure', () => {
    expect(method).toMatch(/await tsAnalyze\(\{/);
    expect(method).toMatch(/if \(outcome\.summary\) \{\s*await sendAnalysisWebhook\(companyId, outcome\);/);
    expect(method).toMatch(/catch \(error\) \{[\s\S]*await releaseAnalysisStatus\(moduleId, companyId\);/);
    expect(method).toMatch(/return summary;/);
  });
});

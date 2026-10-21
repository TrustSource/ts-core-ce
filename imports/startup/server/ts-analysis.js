import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import {runWorker} from '/imports/server/workerRunner';
import {tsWebhook} from '/imports/startup/server/ts-webhook';

// Module analysis runs in a worker thread (workers/analysis). The worker reads the
// module, its scan and its policies from the app database, writes the analysis
// document and the module statistics, and answers with
// {summary, projectId, projectName, moduleName}.
//
// Server-internal only - plain exported functions carry no DDP surface.

export const ANALYSIS_IN_PROGRESS = 'Analysis in progress ...';
export const ANALYSIS_FINISHED = 'Analysis finished';

export async function tsAnalyze(input) {
  try {
    return await runWorker('analysis', input);
  } catch (error) {
    const reason = (error && error.message) || 'Analysis failed';
    console.info('=> tsAnalyze: ', reason);
    throw new Meteor.Error('ts-analysis', reason);
  }
}

// The `analysis` webhook trigger with the payload the ts-analysis worker sends. A delivery
// problem never fails the analysis.
export async function sendAnalysisWebhook(companyId, outcome) {
  try {
    await tsWebhook({
      companyId,
      projectId: outcome.projectId,
      projectName: outcome.projectName,
      moduleName: outcome.moduleName,
      trigger: 'analysis',
      data: outcome.summary
    });
  } catch (error) {
    console.info('=> analysis webhook failed: ', (error && error.message) || error);
  }
}

// A worker that timed out or died leaves the module on "Analysis in progress ...". Only
// that status is moved, so a status the analyzer already set stays, and the write is
// scoped to the caller's company so a bad id for another tenant's module never touches it.
export async function releaseAnalysisStatus(moduleId, companyId) {
  try {
    await Modules.updateAsync({_id: moduleId, companyId: companyId, status: ANALYSIS_IN_PROGRESS},
      {$set: {status: ANALYSIS_FINISHED}});
  } catch (error) {
    console.info('=> releaseAnalysisStatus: ', (error && error.message) || error);
  }
}

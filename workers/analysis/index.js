import { MongoClient } from 'mongodb';
import { ModuleAnalyzer } from './services/ModuleAnalyzer.js';
import { Utils } from './services/Utils.js';
import { setSettings } from './services/Settings.js';

// Module analysis, run by ts-app in a worker thread (imports/startup/server/ts-analysis.js).
// Reads the module, its scan and its policies from the app database, writes the analysis
// document and the module statistics, and answers with the summary.

const WAS_NOT_FOUND = ' was not found';

// Identifying summary of an analysis result: what ts-app returns to the caller and sends
// with the `analysis` webhook. The full result stays in the analysis collection.
export function analysisResultSummary(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }
  return {
    _id: result._id,
    date: result.date,
    scanId: result.scanId,
    companyId: result.companyId,
    moduleId: result.moduleId,
    branch: result.branch,
    tag: result.tag,
    release: result.release,
    latest: result.latest,
    rootComponentsCount: result.rootComponentsCount,
    statistics: result.statistics
  };
}

function requestError(status, message) {
  const error = new Error(status + ' ' + message);
  error.code = status;
  return error;
}

async function findFirst(db, collection, filter, sort) {
  const found = await Utils.dbFind(db, collection, filter, 1, sort);
  return found && found[0];
}

// Split from run() so tests can hand in a stub db.
export async function analyzeWithDb(db, input) {
  const { companyId, moduleId, scanId, demo } = input || {};
  const missing = [];
  if (!companyId) {
    missing.push('companyId');
  }
  if (!moduleId) {
    missing.push('moduleId');
  }
  if (missing.length) {
    throw requestError(400, '[' + missing.join(', ') + '] are required for function execution');
  }

  const user = input.user || await findFirst(db, 'users', { _id: input.userId });
  if (!user) {
    throw requestError(404, 'User ' + input.userId + WAS_NOT_FOUND);
  }
  const company = await findFirst(db, 'companies', { _id: companyId });
  if (!company) {
    throw requestError(404, 'Company ' + companyId + WAS_NOT_FOUND);
  }
  const module = await findFirst(db, 'modules', { companyId, _id: moduleId });
  if (!module) {
    throw requestError(404, 'Module ' + moduleId + WAS_NOT_FOUND);
  }
  let project = { name: 'Unassigned Modules', _id: '$unassigned' };
  if (module.projectId) {
    project = await findFirst(db, 'projects', { companyId, _id: module.projectId });
  }

  const scanFilter = { companyId, moduleId };
  const analysisFilter = { companyId, moduleId };
  if (scanId) {
    scanFilter._id = scanId;
    analysisFilter.scanId = scanId;
  }
  let scan;
  if ((module.infrastructureComponent && module.infrastructureComponent.key) ||
    (module.cotsComponent && module.cotsComponent.key)) {
    scan = await Utils.createScanFromModule(db, module, project, user);
  } else {
    scan = await findFirst(db, 'scans', scanFilter, { submitted: -1 });
  }
  if (!scan || !scan._id) {
    throw requestError(404, (scanId ? 'Scan ' + scanId : 'Scan for module ' + moduleId) + WAS_NOT_FOUND);
  }
  if (scan.branch && scan.branch.length > 0) {
    analysisFilter.branch = scan.branch;
  }
  const lastAnalysis = await findFirst(db, 'analysis', analysisFilter, { date: -1 });

  const analysis = await new ModuleAnalyzer(db, company, project, module, scan, user, lastAnalysis, demo).analyze();
  // analyze() answers with the analysis, with null when there was nothing to analyse, or
  // with the error it logged and recorded on the module.
  if (analysis && !analysis.result) {
    throw analysis instanceof Error ? analysis : new Error(String(analysis.message || analysis));
  }
  return {
    summary: analysis ? analysisResultSummary(analysis.result) : null,
    projectId: project && project._id,
    projectName: project && project.name,
    moduleName: module.name
  };
}

export async function run(input, settings) {
  setSettings(settings);
  const client = new MongoClient(settings.MONGO_URL, { maxPoolSize: 5 });
  try {
    await client.connect();
    return await analyzeWithDb(client.db(), input);
  } finally {
    await client.close();
  }
}

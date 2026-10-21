/* global process:false */
import {Config} from '/imports/server/config';
import {Config as AppConfig} from '/imports/config';
import {createWorkerRunner} from './runWorker';

// Module analysis and webhook delivery run in worker threads from workers/ (see
// runWorker.js). The limits below are what the work actually needs: an analysis may
// use 1024 MB and runs minutes at most, a webhook call is short.
export const WORKER_LIMITS = {
  analysis: {
    concurrency: Config.TS_ANALYSIS_CONCURRENCY,
    timeoutMs: 5 * 60 * 1000,
    maxOldGenerationSizeMb: 1024
  },
  webhook: {
    concurrency: 4,
    // Webhook.Send allows each target 60 s; the targets are delivered in parallel.
    timeoutMs: 90 * 1000
  }
};

// Everything a worker may read. Worker code never reads process.env itself.
function workerSettings() {
  return {
    MONGO_URL: process.env.MONGO_URL,
    TS_CHECK_SERVER: Config.TS_CHECK_SERVER,
    // This installation's address (ROOT_URL, trailing slash) for links the workers build.
    APP_URL: AppConfig.appUrl,
    TS_OSV_ENABLED: Config.TS_OSV_ENABLED === true,
    DEBUG_MODE_ENABLED: Config.DEBUG_MODE_ENABLED
  };
}

const runner = createWorkerRunner({
  workersDir: Config.TS_WORKERS_DIR,
  getSettings: workerSettings,
  limits: WORKER_LIMITS
});

// Server-internal only: a plain function carries no DDP surface.
export function runWorker(service, input) {
  return runner.run(service, input);
}

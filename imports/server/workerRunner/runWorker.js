import {Worker} from 'worker_threads';
import path from 'path';

// Runs one call of a service in workers/ (outside the Meteor bundle) on its own thread:
// workers/entry.js imports the service, runs it with the input and the settings, and
// posts one message back. The thread is terminated as soon as the call settles, so a
// crash, a leak or a hang inside a service never outlives the call or reaches the app.
//
// Calls beyond a service's concurrency limit wait in a FIFO queue; a slot is freed only
// once the previous thread has exited, so the limit also bounds live threads.
//
// Meteor-free on purpose: jest loads this file directly.

export const WORKER_TIMEOUT = 'WORKER_TIMEOUT';
export const WORKER_CRASHED = 'WORKER_CRASHED';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// The error a service reported ({message, code} from workers/entry.js).
function serviceError(reported) {
  return codedError((reported && reported.code) || 'SERVICE_ERROR',
    (reported && reported.message) || 'Worker service failed');
}

function noop() {}

// A terminate that is already underway (or already happened) must never surface as an
// unhandled rejection.
function terminateWorker(worker) {
  worker.terminate().catch(noop);
}

// Frees the service's queue slot once a call has both settled and its thread is gone,
// then starts the next waiting call, if any. Pulled out of `run()` so the callback isn't
// nested one level deeper than the lint rule allows.
function releaseQueueSlot(call, queue) {
  call.result.catch(noop).then(function () {
    return call.exited;
  }).then(function () {
    queue.active -= 1;
    const next = queue.waiting.shift();
    if (next) {
      next();
    }
  });
}

export function createWorkerRunner({workersDir, getSettings, limits, WorkerClass}) {
  const WorkerThread = WorkerClass || Worker;
  const queues = {};

  // Starts the thread. `result` settles with the call, `exited` once the thread is gone.
  function startCall(service, input, serviceLimits) {
    let exited = Promise.resolve();
    const result = new Promise(function (resolve, reject) {
      const options = {
        workerData: {service, input, settings: getSettings()},
        // Meteor's own flags (--require hooks, --inspect) must not reach the thread.
        execArgv: []
      };
      if (serviceLimits.maxOldGenerationSizeMb) {
        options.resourceLimits = {maxOldGenerationSizeMb: serviceLimits.maxOldGenerationSizeMb};
      }
      const worker = new WorkerThread(path.join(workersDir, 'entry.js'), options);
      exited = new Promise(function (resolveExit) {
        worker.once('exit', resolveExit);
      });
      let settled = false;

      function finish(error, value) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        terminateWorker(worker);
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      }

      const timer = setTimeout(function () {
        finish(codedError(WORKER_TIMEOUT,
          service + ' worker did not finish within ' + serviceLimits.timeoutMs + ' ms'));
      }, serviceLimits.timeoutMs);

      worker.on('message', function (message) {
        if (message && message.ok) {
          finish(null, message.result);
        } else {
          finish(serviceError(message && message.error));
        }
      });
      worker.on('error', function (error) {
        finish(codedError(WORKER_CRASHED,
          service + ' worker crashed: ' + ((error && error.message) || error)));
      });
      worker.on('exit', function (exitCode) {
        finish(codedError(WORKER_CRASHED,
          service + ' worker exited with code ' + exitCode + ' before answering'));
      });
    });
    return {result, exited};
  }

  function run(service, input) {
    const serviceLimits = Object.prototype.hasOwnProperty.call(limits, service) ? limits[service] : null;
    if (!serviceLimits) {
      return Promise.reject(new Error('Unknown worker service: ' + service));
    }
    const queue = queues[service] || (queues[service] = {active: 0, waiting: []});
    return new Promise(function (resolve, reject) {
      function start() {
        queue.active += 1;
        const call = startCall(service, input, serviceLimits);
        call.result.then(resolve, reject);
        releaseQueueSlot(call, queue);
      }
      if (queue.active < serviceLimits.concurrency) {
        start();
      } else {
        queue.waiting.push(start);
      }
    });
  }

  return {run};
}

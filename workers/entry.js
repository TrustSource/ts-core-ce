import { parentPort, workerData } from 'node:worker_threads';

// Bootstrap of one worker thread started by ts-app (imports/server/workerRunner/runWorker.js):
// runs `run(input, settings)` of the named service and posts exactly one message back,
// {ok: true, result} or {ok: false, error: {message, code}}. ts-app terminates the thread
// once it has the message.
const SERVICES = {
  analysis: () => import('./analysis/index.js'),
  webhook: () => import('./webhook/index.js')
};

let replied = false;

// Marked as replied only once postMessage succeeded, so a result that cannot be cloned
// is still answered with a failure.
function reply(message) {
  if (replied) {
    return;
  }
  parentPort.postMessage(message);
  replied = true;
}

function failure(error) {
  return {
    ok: false,
    error: {
      message: (error && error.message) || String(error),
      code: error && error.code
    }
  };
}

// A rejection nobody awaits (the analyzer has had those) must fail this call, not hang it.
process.on('unhandledRejection', (reason) => reply(failure(reason)));
process.on('uncaughtException', (error) => reply(failure(error)));

async function main() {
  const { service, input, settings } = workerData || {};
  const load = Object.prototype.hasOwnProperty.call(SERVICES, service) ? SERVICES[service] : null;
  if (!load) {
    throw new Error('Unknown worker service: ' + service);
  }
  const { run } = await load();
  reply({ ok: true, result: await run(input, settings || {}) });
}

main().catch((error) => reply(failure(error)));

/* eslint-disable no-undef */
// Stand-in for workers/entry.js in worker-runner.unit.spec.js: a real thread that ends
// its call the way `input.behaviour` says.
const {parentPort, workerData} = require('worker_threads');

const {input, settings} = workerData;

switch (input.behaviour) {
case 'return':
  parentPort.postMessage({ok: true, result: {echo: input.value, settings: settings}});
  break;
case 'throw':
  parentPort.postMessage({ok: false, error: {message: 'service failed', code: 'E_SERVICE'}});
  break;
case 'unhandled':
  Promise.reject(new Error('unhandled in worker'));
  setInterval(function () {}, 1000);
  break;
case 'hang':
  setInterval(function () {}, 1000);
  break;
case 'exit':
  process.exit(3);
  break;
case 'slow':
  setTimeout(function () {
    parentPort.postMessage({ok: true, result: input.value});
  }, input.delayMs);
  break;
default:
  parentPort.postMessage({ok: false, error: {message: 'unknown behaviour'}});
}

// The settings of the current run, handed over by ts-app (imports/server/workerRunner)
// and set by run() before anything else. A worker thread runs exactly one call, so
// this is per call.
let current = {};

export function setSettings(settings) {
  current = Object.assign({}, settings || {});
}

export function getSettings() {
  return current;
}

export function requestLogEnabled() {
  return current.DEBUG_MODE_ENABLED === true;
}

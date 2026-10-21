import axios from 'axios';
import { getSettings, requestLogEnabled } from './Settings.js';

// One call checks the whole module, so it gets the time the old asynchronous submit
// and the result polling had together.
const CHECK_TIMEOUT_MS = 120000;

function checkModuleUrl() {
  const base = getSettings().TS_CHECK_SERVER;
  return base ? base.replace(/\/+$/, '') + '/check-module' : null;
}

// Status, code and the error message only, never the request body (the whole module).
// Without this line a misconfigured check server silently degrades every license to a warning.
function logCheckFailure(err) {
  const status = err && err.response && err.response.status;
  const hint = status >= 300 && status < 400
    ? ' - the check server redirects: set TS_CHECK_SERVER to its final URL (for example https instead of http)'
    : '';
  console.log('=> CheckModule failed: status %s, code %s, %s%s',
    status || '-', (err && err.code) || '-', (err && err.message) || 'unknown error', hint);
}

let TSCheck = {};

// The CE legal check service (docker/ts-legalcheck-api.py in ts-app) answers
// synchronously with {moduleKey: {componentKey:version:pathIndex: {licenseKey: result}}}.
// Never throws: an unset or unreachable service comes back as a non-200 response, and
// evaluateLicenses then leaves the licenses unevaluated (reported as warnings).
TSCheck.CheckModule = async function CheckModule(moduleObject) {
  const url = checkModuleUrl();
  if (!url) {
    console.info('=> CheckModule: TS_CHECK_SERVER is not set');
    return {status: 503, error: 'TS_CHECK_SERVER is not set'};
  }
  const startTime = new Date();
  const params = {
    method: 'post',
    headers: {'Content-Type': 'application/json'},
    data: moduleObject,
    timeout: CHECK_TIMEOUT_MS,
    // Following a redirect would turn the POST into a GET without the module; the 3xx
    // comes back as a non-200 response instead (see logCheckFailure).
    maxRedirects: 0
  };
  if (requestLogEnabled()) {
    console.info('=> CheckModule request: ', JSON.stringify(params));
  } else {
    console.info('=> CheckModule request: ', moduleObject && moduleObject.key);
  }
  try {
    const request = await axios(url, params);
    if (requestLogEnabled()) {
      console.info('=> CheckModule result: ', JSON.stringify(request && request.data));
    }
    return request;
  } catch (err) {
    logCheckFailure(err);
    return (err && err.response) || {status: 503, error: err && err.message};
  } finally {
    console.info('=> CheckModule: took %s millis', new Date() - startTime);
  }
};

export {
  TSCheck
};

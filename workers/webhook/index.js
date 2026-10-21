import { Webhook } from './services/Webhook.js';
import { appBaseUrl } from '../analysis/services/appUrl.js';

// Delivers one webhook event to the targets ts-app resolved and egress-checked
// (imports/startup/server/ts-webhook.js). Runs in a worker thread and touches no
// database.
//
// input: {trigger, data, scope: {companyId, projectId, projectName, moduleId, moduleName}, targets}
// settings.APP_URL: this installation's address, the base of every link a message carries.
// A target carries `resolvedAddresses`, the addresses ts-app checked for its host; the
// delivery connects only to those.
// Resolves to one entry per target, in target order: {status, data} or {errorMessage}.
export async function run(input, settings) {
  const { trigger, data, scope, targets } = input || {};
  if (!Array.isArray(targets)) {
    throw new Error('targets must be an array');
  }
  if (!data) {
    throw new Error('data is required');
  }
  const appUrl = appBaseUrl((settings || {}).APP_URL);
  return Promise.all(targets.map((target) => deliver(target, trigger, data, scope || {}, appUrl)));
}

async function deliver(target, trigger, data, scope, appUrl) {
  try {
    const response = await Webhook.Send({
      url: target.url,
      method: target.method || 'POST',
      headers: target.headers || [],
      data: Webhook.GetDataByTrigger(target, trigger, data, scope, appUrl),
      resolvedAddresses: target.resolvedAddresses,
      signingSecret: target.signingSecret
    });
    if (response && response.status) {
      return { status: response.status, data: response.data || response.statusText };
    }
    // Webhook.Send answers a failed request with the error message itself.
    return { errorMessage: response };
  } catch (error) {
    return { errorMessage: error && error.message };
  }
}

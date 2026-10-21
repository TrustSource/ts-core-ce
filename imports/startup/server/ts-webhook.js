import Webhooks from '/imports/lib/collections/webhooks';
import {Config} from '/imports/server/config';
import {assertSafeEgressUrl} from '/imports/lib/security/ssrfGuard';
import {openWebhookRow} from '/imports/server/security/webhookSecrets';
import {runWorker} from '/imports/server/workerRunner';

// What the DEBUG_MODE_ENABLED log line may print.
//
// A caller may pass explicit `webhook` documents to skip the lookup (that is how the
// vulnerability-alert feature delivers to a project receiver only), and
// every looked-up row ends up in the same field. Those documents carry the receiver's
// `headers` and `url`, and BOTH are credentials: a Slack or Teams incoming-webhook URL
// is itself a bearer token, and a header is where an API key lives. So the log line is
// built from a redacted copy.
//
// The request itself is untouched - only the log line changes. Exported so a spec can
// assert that no header value and no url survives.
export function redactWebhookRequest(reqData) {
  const source = reqData || {};
  const redacted = Object.assign({}, source);
  // Normalised to an array FIRST. A single webhook document would otherwise sail
  // through the shallow copy verbatim, headers and url included.
  if (source.webhook) {
    const rows = Array.isArray(source.webhook) ? source.webhook : [source.webhook];
    redacted.webhook = rows.map(function (row) {
      const entry = row || {};
      return {
        _id: entry._id,
        name: entry.name,
        type: entry.type,
        method: entry.method,
        url: '<redacted>',
        headers: ((entry.headers && entry.headers.length) || 0) + ' redacted'
      };
    });
  }
  // `data` is our own content, not the receiver's credentials, and it is what
  // the log exists to show. It stays readable.
  return redacted;
}

// Drop every webhook target whose url fails the egress check, right before delivery.
//
// Delivery runs inside the app's own network, so the check resolves the host and refuses
// the row when ANY address it gets is internal (assertSafeEgressUrl). The save-time gates in
// webhooks/create.js and the Webhooks insert allow rule resolve nothing: a host name such as
// localhost or an internal service name passes them, and rows stored before either gate
// existed keep their targets. tsWebhook runs this over every target - looked up or handed
// in - so no row can make the app send a request to an internal address.
//
// NOT REDUNDANT with the input gate in server/collections/webhooks.js - do not delete it
// as such: that gate is prospective and name-only, this one covers every row with DNS.
//
// A kept row goes to the worker as a COPY carrying `resolvedAddresses`, the addresses that
// were checked; the delivery connects only to those, so a DNS answer that changes after this
// check cannot move it. The stored row is never changed.
//
// The row id and a generic reason are logged, never the url (it is itself a bearer token)
// and never a header.
const DROPPED = {};
const EGRESS_CHECK_FAILED = 'egress check failed';

async function checkWebhookTarget(storedRow) {
  // Stored url and header values are encrypted; delivery needs them in the clear.
  const row = openWebhookRow(storedRow);
  const url = row && row.url;
  if (!url) {
    // Nothing to send to; the delivery reports it. Not an egress decision.
    return row;
  }
  try {
    const checked = await assertSafeEgressUrl(url);
    return Object.assign({}, row, {resolvedAddresses: checked.addresses.slice()});
  } catch (error) {
    // ssrfGuard's own message is deliberately host-free; anything else is replaced.
    const reason = (error && error.isSsrf && error.message) || EGRESS_CHECK_FAILED;
    console.info('=> tsWebhook: webhook target', row._id || '<no id>', 'was dropped:', reason);
    return DROPPED;
  }
}

export async function filterUnsafeWebhookTargets(reqData) {
  if (!reqData || !reqData.webhook) {
    return reqData;
  }
  // Normalised to an array FIRST, exactly as redactWebhookRequest is, so a single
  // document cannot skip the egress filter.
  const rows = Array.isArray(reqData.webhook) ? reqData.webhook : [reqData.webhook];
  const checked = await Promise.all(rows.map(checkWebhookTarget));
  const safe = checked.filter(function (row) {
    return row !== DROPPED;
  });
  return Object.assign({}, reqData, {webhook: safe});
}

// The rows an event is delivered to when the caller names none: the company's rows for
// the trigger, company-wide or for the event's project.
export function webhookTargetSelector(companyId, projectId, trigger) {
  const scope = projectId
    ? {$or: [{projectId: {$exists: false}}, {projectId: projectId}]}
    : {projectId: {$exists: false}};
  return {$and: [{companyId: companyId, triggers: {$in: [trigger]}}, scope]};
}

function requiredMessage(fields) {
  return '400 [' + fields.join(', ') + '] are required for function execution';
}

// A field that ends up in a Mongo selector must be checked with typeof, not
// truthiness (CLAUDE.md "always strip $-prefixed keys ... typeof value ===
// 'string'"): `{companyId: {$ne: null}}` is truthy, and dropped straight into
// `webhookTargetSelector` it would widen the query to every company's rows.
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Look the receivers up when the caller names none - the lookup the ts-webhook
// delivery service used to run. Returns {errorMessage} for a bad request or an empty
// result, or {targets}. Never throws: a Mongo failure is left to reject, and
// the caller (tsWebhook) is the one guarded region that turns any of this
// into {errorMessage}.
async function lookupWebhookTargets(request) {
  if (!isNonEmptyString(request.companyId) || !isNonEmptyString(request.trigger)) {
    return {errorMessage: requiredMessage(['companyId', 'trigger'])};
  }
  if (request.projectId !== undefined && request.projectId !== null &&
      typeof request.projectId !== 'string') {
    return {errorMessage: '400 [projectId] must be a string'};
  }
  const rows = await Webhooks.find(
    webhookTargetSelector(request.companyId, request.projectId, request.trigger),
    {transform: null}).fetchAsync();
  if (!rows.length) {
    return {errorMessage: '404 Webhook by ' + request.companyId +
      (request.projectId ? ' and ' + request.projectId : '') +
      ' with trigger ' + request.trigger + ' was not found'};
  }
  return {targets: rows};
}

// The DEBUG_MODE_ENABLED log line, split out so tsWebhook's guarded region
// reads as one straight line of steps rather than a nested conditional.
function logDebugDetails(reqData) {
  if (Config.DEBUG_MODE_ENABLED) {
    console.log(`=> ts-webhook details ${JSON.stringify(redactWebhookRequest(reqData))}`);
  }
}

// Deliver a webhook event. Server-internal only - exported as a plain function so it
// carries no DDP surface. Never throws: every failure - a bad request, a lookup that
// finds nothing, a Mongo error, or a worker crash/timeout - comes back as {errorMessage}.
export async function tsWebhook(rawReqData) {
  const request = rawReqData || {};
  if (!request.data) {
    return {errorMessage: requiredMessage(['data'])};
  }
  try {
    let targets = request.webhook;
    if (!targets) {
      const looked = await lookupWebhookTargets(request);
      if (looked.errorMessage) {
        return looked;
      }
      targets = looked.targets;
    }
    const reqData = await filterUnsafeWebhookTargets(Object.assign({}, request, {webhook: targets}));
    logDebugDetails(reqData);
    if (!reqData.webhook.length) {
      return [];
    }
    return await runWorker('webhook', {
      trigger: reqData.trigger,
      data: reqData.data,
      scope: {
        companyId: reqData.companyId,
        projectId: reqData.projectId,
        projectName: reqData.projectName,
        moduleId: reqData.moduleId,
        moduleName: reqData.moduleName
      },
      targets: reqData.webhook
    });
  } catch (error) {
    const message = (error && error.message) || 'webhook delivery failed';
    console.info('=> tsWebhook: ', message);
    return {errorMessage: message};
  }
}

import axios from 'axios';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { appLink } from '../../analysis/services/appUrl.js';

let Webhook = {};

//eslint-disable-next-line sonarjs/no-clear-text-protocols
const SCHEMA_EXT = "http://schema.org/extensions"
const MESSAGE_SUMMARY = "Analysis completed"
const ACTION_LABEL = "View details"
const VULNS_FOUND = "Vulnerabilities found "
const APPROVAL = "Approval "
const TASK_CREATED = "Task created"
const THEME_COLOR = "40B29D"
const OPEN_URI = "OpenUri"
const ACTION_ID = "button-action"
const MSWF_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive"
//eslint-disable-next-line sonarjs/no-clear-text-protocols
const MSWF_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json"
const MSWF_OPEN_URI = "Action.OpenUrl"
const UNASSIGNED = '$unassigned'
const NEW_RELEASE = "Release created by "
const FOR_PROJECT = " for project "
const VULNERABILITY_REPORT = "reports/vulnerability"
const IN_SCOPE = "in "
// ts-app applies no cap to a grouped message: one module can carry hundreds of
// CVEs, and Slack rejects a text object over 3000 characters.
const CVES_RENDERED_MAX = 20
// ts-app's own vocabulary (alertPolicy.severityOfScore) - note `moderate`.
const SEVERITY_COLOR = {critical: "B02A2A", high: "D9534F", moderate: "F0AD4E", low: "5BC0DE", none: THEME_COLOR}
// An Adaptive Card takes an enum here, never a hex.
const SEVERITY_CARD_COLOR = {critical: "attention", high: "attention", moderate: "warning", low: "accent", none: "default"}
const VULNS_BY_MODULE = 'vulnerabilitiesByModule'
const VULNS_BY_PROJECT = 'vulnerabilitiesByProject'
const VULNS_BY_RELEASE = 'vulnerabilitiesByRelease'
const GROUPED_VULNERABILITY_TRIGGERS = [VULNS_BY_MODULE, VULNS_BY_PROJECT, VULNS_BY_RELEASE]

function IsGroupedVulnerability(trigger) {
  return GROUPED_VULNERABILITY_TRIGGERS.indexOf(trigger) > -1
}

// The CVE list a message may show: capped, and saying how many were left out.
function CveList(cves) {
  let list = Array.isArray(cves) ? cves : []
  let shown = list.slice(0, CVES_RENDERED_MAX)
  let omitted = list.length - shown.length
  return shown.join(', ') + (omitted > 0 ? ' (+' + omitted + ' more)' : '')
}

// The body line of a per-component `vulnerability` message: the component, the
// versions it was found in, and the CVEs. One helper so all three channels say
// the same thing - teamsWorkflow never showed the CVEs, teams put them in the
// MessageCard `summary` (which Teams does not display) and slack never showed
// the versions.
function ComponentVulnerabilityText(data) {
  let alert = data || {}
  let versions = Array.isArray(alert.versions) && alert.versions.length
    ? ' in versions: ' + alert.versions.join(', ') : ''
  let cveList = CveList(alert.cves)
  return (alert.componentKey || '') + versions + (cveList ? ' - ' + cveList : '')
}

// Where the button of a per-component `vulnerability` message points. The old
// `component-search/<componentKey>` target lists the component company-wide and
// never says WHICH modules are affected, so it opens the vulnerability report of
// the project the alert belongs to - narrowed by the project the alert names, or
// else the one in scope. A company-wide row can fire with no project at all; the
// report is still the right page, it just cannot be narrowed.
function ComponentVulnerabilityUrl(data, params, appUrl) {
  let projectId = (data || {}).projectId || (params || {}).projectId
  return appLink(appUrl, VULNERABILITY_REPORT + (projectId ? '?projectId=' + projectId : ''))
}

// The three grouped vulnerability triggers share one payload
// shape, so all three channels render them from this one view: what the alert
// is about, which CVEs it carries, where to look, and how bad it is.
// The granularity is the TRIGGER; the ids inside `data` follow from it, and a
// message whose own id is missing falls back to the project it belongs to.
function GroupedVulnerabilityView(trigger, data, params, appUrl) {
  let alert = data || {}
  let scope = params || {}
  let projectId = alert.projectId || scope.projectId
  let severity = alert.severity || 'none'
  let cveList = CveList(alert.cves)
  let subject, url
  if(trigger === VULNS_BY_MODULE && alert.moduleId){
    subject = 'module ' + (alert.moduleName || alert.moduleId)
    url = appLink(appUrl, 'projects/' + (projectId || UNASSIGNED) + '/modules/' + alert.moduleId + '/dependencies')
  }else if(trigger === VULNS_BY_RELEASE && alert.releaseId){
    subject = 'release ' + (alert.releaseName || alert.releaseId)
    url = appLink(appUrl, 'releases/' + alert.releaseId + '/new_vulnerabilities')
  }else{
    subject = 'project ' + (alert.projectName || scope.projectName || projectId || '')
    url = appLink(appUrl, 'projects/' + (projectId || UNASSIGNED))
  }
  return {
    summary: VULNS_FOUND + cveList,
    text: VULNS_FOUND + IN_SCOPE + subject + ' (' + severity + ')' + (cveList ? ': ' + cveList : ''),
    url: url,
    color: SEVERITY_COLOR[severity] || THEME_COLOR,
    cardColor: SEVERITY_CARD_COLOR[severity] || 'default'
  }
}

Webhook.GetDataByTeamsWorkflow = function GetDataByTeamsWorkflow(webhook, trigger, data, params, appUrl) {
  if(trigger === 'analysis'){
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text": `${MESSAGE_SUMMARY} for ${params.moduleName} in ${params.projectName}`,
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": appLink(appUrl, `projects/${params.projectId || UNASSIGNED}/modules/${data.moduleId}/dependencies?analysis=${data._id}`)
              }
            ]
          }
        }
      ]
    }
  }else if(trigger === 'release'){
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text": NEW_RELEASE + data.closedByName + FOR_PROJECT + params.projectName,
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": appLink(appUrl, `releases/${data._id}/overview`)
              }
            ]
          }
        }
      ]
    }
  }else if(trigger === 'vulnerability'){
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text": ComponentVulnerabilityText(data),
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": ComponentVulnerabilityUrl(data, params, appUrl)
              }
            ]
          }
        }
      ]
    }
  }else if(trigger === 'approval'){
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text":  APPROVAL + (data.approved ? 'approved': 'rejected') + " by " + data.closedByName + FOR_PROJECT + params.projectName,
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": appLink(appUrl, `approves/${data._id}/overview`)
              }
            ]
          }
        }
      ]
    }
  }else if(trigger === 'task'){
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text":  TASK_CREATED,
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": appLink(appUrl, `projects/${params.projectId}`)
              }
            ]
          }
        }
      ]
    }
  }else if(IsGroupedVulnerability(trigger)){
    let view = GroupedVulnerabilityView(trigger, data, params, appUrl)
    return {
      "type": "message",
      "attachments": [
        {
          "contentType": MSWF_CONTENT_TYPE,
          "content": {
            "$schema": MSWF_SCHEMA,
            "type": "AdaptiveCard",
            "version": "1.2",
            "body": [
              {
                "type": "TextBlock",
                "text": webhook.name,
                "weight": "bolder",
                "size": "medium",
                "wrap": true
              },
              {
                "type": "TextBlock",
                "text": view.text,
                "color": view.cardColor,
                "wrap": true
              }
            ],
            "actions": [
              {
                "type": MSWF_OPEN_URI,
                "title": ACTION_LABEL,
                "url": view.url
              }
            ]
          }
        }
      ]
    }
  }
  return data
};
Webhook.GetDataByTeams = function GetDataByTeams(webhook, trigger, data, params, appUrl) {
  if(trigger === 'analysis'){
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": THEME_COLOR,
      "summary": MESSAGE_SUMMARY,
      "sections": [{
        "activityTitle": webhook.name,
        "activitySubtitle": `${MESSAGE_SUMMARY} for ${params.moduleName} in ${params.projectName}`,
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": appLink(appUrl, `projects/${params.projectId || UNASSIGNED}/modules/${data.moduleId}/dependencies?analysis=${data._id}`),
        }]
      }]
    }
  }else if(trigger === 'release'){
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": THEME_COLOR,
      "summary": "Release created",
      "sections": [{
        "activityTitle": webhook.name,
        "activitySubtitle": NEW_RELEASE + data.closedByName + FOR_PROJECT + params.projectName,
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": appLink(appUrl, "releases/"+ data._id +"/overview")
        }]
      }]
    }
  }else if(trigger === 'vulnerability'){
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": THEME_COLOR,
      "summary": VULNS_FOUND + (data.cves ? data.cves.join(', '): ''),
      "sections": [{
        "activityTitle": webhook.name,
        "activitySubtitle": ComponentVulnerabilityText(data),
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": ComponentVulnerabilityUrl(data, params, appUrl)
        }]
      }]
    }
  }else if(trigger === 'approval'){
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": THEME_COLOR,
      "summary": APPROVAL + (data.approved ? 'approved': 'rejected'),
      "sections": [{
        "activityTitle": webhook.name,
        "activitySubtitle": APPROVAL + (data.approved ? 'approved': 'rejected') + " by " + data.closedByName + FOR_PROJECT + params.projectName,
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": appLink(appUrl, "approves/"+ data._id +"/overview")
        }]
      }]
    }
  }else if(trigger === 'task'){
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": THEME_COLOR,
      "summary": TASK_CREATED,
      "sections": [{
        "activityTitle": webhook.name,
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": appLink(appUrl, "projects/"+ params.projectId)
        }]
      }]
    }
  }else if(IsGroupedVulnerability(trigger)){
    let view = GroupedVulnerabilityView(trigger, data, params, appUrl)
    return {
      "@type": "MessageCard",
      "@context": SCHEMA_EXT,
      "themeColor": view.color,
      "summary": view.summary,
      "sections": [{
        "activityTitle": webhook.name,
        "activitySubtitle": view.text,
        "markdown": true
      }],
      "potentialAction": [{
        "@type": OPEN_URI,
        "name": ACTION_LABEL,
        "targets": [{
          "os": "default",
          "uri": view.url
        }]
      }]
    }
  }
  return data
};
Webhook.GetDataBySlack = function GetDataBySlack(webhook, trigger, data, params, appUrl) {
  if(trigger === 'analysis'){
    return {
      "fallback": MESSAGE_SUMMARY,
      "color": "#40B29D",
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": `${MESSAGE_SUMMARY} for ${params.moduleName} in ${params.projectName}`,
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": appLink(appUrl, `projects/${params.projectId || UNASSIGNED}/modules/${data.moduleId}/dependencies?analysis=${data._id}`),
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }else if(trigger === 'release'){
    return {
      "fallback": "Release created",
      "color": "#40B29D",
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": NEW_RELEASE + data.closedByName + FOR_PROJECT + params.projectName,
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": appLink(appUrl, "releases/"+ data._id +"/overview"),
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }else if(trigger === 'vulnerability'){
    return {
      "fallback": VULNS_FOUND + (data.cves ? data.cves.join(', '): ''),
      "color": "#40B29D",
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": ComponentVulnerabilityText(data),
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": ComponentVulnerabilityUrl(data, params, appUrl),
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }else if(trigger === 'approval'){
    return {
      "fallback": APPROVAL + (data.approved ? 'approved': 'rejected'),
      "color": "#40B29D",
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": APPROVAL + (data.approved ? 'approved': 'rejected') + " by " + data.closedByName + FOR_PROJECT + params.projectName,
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": appLink(appUrl, "approves/"+ data._id +"/overview"),
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }else if(trigger === 'task'){
    return {
      "fallback": TASK_CREATED,
      "color": "#40B29D",
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": TASK_CREATED,
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": appLink(appUrl, "projects/"+ params.projectId),
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }else if(IsGroupedVulnerability(trigger)){
    let view = GroupedVulnerabilityView(trigger, data, params, appUrl)
    return {
      "fallback": view.summary,
      "color": "#" + view.color,
      "blocks": [
        {
          "type": "rich_text",
          "elements": [
            {
              "type": "rich_text_section",
              "elements": [
                {
                  "type": "text",
                  "text": webhook.name
                }
              ]
            }
          ]
        },
        {
          "type": "context",
          "elements": [
            {
              "type": "plain_text",
              "text": view.text,
              "emoji": true
            }
          ]
        },
        {
          "type": "actions",
          "elements": [
            {
              "type": "button",
              "text": {
                "type": "plain_text",
                "text": ACTION_LABEL,
                "emoji": true
              },
              "value": "click_me",
              "url": view.url,
              "action_id": ACTION_ID
            }
          ]
        }
      ]
    }
  }
  return data;
};

Webhook.GetDataByTrigger = function GetDataByTrigger(webhook, trigger, data, params, appUrl) {
  if(webhook.type === 'teams'){
    return Webhook.GetDataByTeams(webhook, trigger, data, params, appUrl)
  }else if(webhook.type === 'teamsWorkflow'){
    return Webhook.GetDataByTeamsWorkflow(webhook, trigger, data, params, appUrl)
  }else if(webhook.type === 'slack'){
    return Webhook.GetDataBySlack(webhook, trigger, data, params, appUrl)
  }
  return data;
};

function requestedFamily(options) {
  const family = typeof options === 'number' ? options : options && options.family;
  if (family === 4 || family === 'IPv4') {
    return 4;
  }
  if (family === 6 || family === 'IPv6') {
    return 6;
  }
  return 0;
}

// ts-app resolved the target's host and checked every address it got before handing the
// target over (imports/startup/server/ts-webhook.js). This lookup answers with exactly those
// addresses, so a DNS answer that changes after the check cannot move the delivery to an
// address nobody checked. Node asks in two forms: `all: true` wants [{address, family}],
// otherwise (err, address, family). No usable address fails the connection; the system
// resolver is never asked.
function pinnedLookup(addresses) {
  const records = addresses
    .map((address) => ({ address: String(address), family: net.isIP(String(address)) }))
    .filter((record) => record.family !== 0);
  return function lookup(hostname, options, callback) {
    const done = typeof options === 'function' ? options : callback;
    const family = requestedFamily(options);
    const answers = records.filter((record) => !family || record.family === family);
    if (!answers.length) {
      const error = new Error('no checked address for the webhook target');
      error.code = 'ENOTFOUND';
      process.nextTick(done, error);
      return;
    }
    if (options && options.all) {
      process.nextTick(done, null, answers.map((record) => ({ address: record.address, family: record.family })));
      return;
    }
    process.nextTick(done, null, answers[0].address, answers[0].family);
  };
}

// The URL keeps its host name: the Host header and TLS (SNI and the certificate check)
// still use it, only the connection goes to a checked address.
function pinnedAgents(resolvedAddresses) {
  if (!Array.isArray(resolvedAddresses) || !resolvedAddresses.length) {
    return null;
  }
  const options = { lookup: pinnedLookup(resolvedAddresses) };
  return { http: new http.Agent(options), https: new https.Agent(options) };
}

// What a failed delivery may log. A serialised AxiosError carries the request config: the
// url and the headers are the receiver's credentials, and the body is the event itself.
function describeFailure(err) {
  const error = err || {};
  return JSON.stringify({
    message: error.message,
    code: error.code,
    status: error.response && error.response.status
  });
}

/**
 * Headers that let a receiver verify a delivery came from this installation:
 * X-TrustSource-Signature is `sha256=` + the hex HMAC-SHA256 of
 * `<X-TrustSource-Timestamp>.<body>` keyed with the webhook's signing secret. The
 * timestamp (unix seconds) lets the receiver refuse replays.
 */
export function signatureHeaders(signingSecret, body, now = Date.now()) {
  if (typeof signingSecret !== 'string' || !signingSecret) {
    return {};
  }
  const timestamp = String(Math.floor(now / 1000));
  const signature = crypto.createHmac('sha256', signingSecret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return {'X-TrustSource-Timestamp': timestamp, 'X-TrustSource-Signature': `sha256=${signature}`};
}

Webhook.Send = async function Send({url, method, headers, data, resolvedAddresses, signingSecret}) {
  const startTime = new Date();
  let requestHeaders = {
    'Content-Type': 'application/json'
  }
  if(headers){
    headers.forEach(item=>{
      requestHeaders[item.key] = item.value
    })
  }
  // The body is serialised here, so the bytes signed are the bytes sent.
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  Object.assign(requestHeaders, signatureHeaders(signingSecret, body));
  const agents = pinnedAgents(resolvedAddresses);
  let request = {};
  try {
    const params = {
      method,
      headers: requestHeaders,
      data: body,
      url: url,
      timeout: 60000,
      // A redirect is not a delivery: following it would send the event, and the
      // receiver's headers, to an address nobody checked. A 3xx comes back as an error.
      maxRedirects: 0,
    };
    if (agents) {
      params.httpAgent = agents.http;
      params.httpsAgent = agents.https;
      // A proxy from the environment would connect somewhere else than the pinned address.
      params.proxy = false;
    }
    request = await axios(params.url, params);
    console.info('=> Webhook.Send: took %s millis', new Date() - startTime);
  } catch (err) {
    console.log('=> an error occurred: ', describeFailure(err));
    console.info('=> Webhook.Send: took %s millis', new Date() - startTime);
    return err && err.message;
  } finally {
    if (agents) {
      agents.http.destroy();
      agents.https.destroy();
    }
  }
  return request;
};

export {
  Webhook
};

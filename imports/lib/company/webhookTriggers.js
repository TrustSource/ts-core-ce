// The canonical list of Webhooks & Channels triggers, and their display labels.
//
// ONE declaration, because the same list is spelled in three places today: the
// Add-webhook dialog's <option> list, and the Triggers column of BOTH webhook
// list pages (project settings and company settings).
//
// WHY A LABEL MAP AND NOT toTitleCase
//
// Both list pages render `toTitleCase(trigger)`, which upper-cases the first
// character and LOWER-CASES the remainder. That is invisible while every trigger
// is a single lower-case word, and wrong the moment one is not:
// `toTitleCase('vulnerabilitiesByModule')` is `'Vulnerabilitiesbymodule'`, and
// the shipped `teamsWorkflow` webhook TYPE already renders as
// `'Teamsworkflow'` for the same reason.
//
// The stored value stays camelCase, matching that `teamsWorkflow` precedent -
// changing it would orphan every webhook row a customer has already created.
//
// CommonJS with no meteor/* imports so Jest can require it directly AND the
// Blaze templates can import it - the same dual-consumption pattern as
// cweRiskPlan.js / alertPolicy.js.

// THE VULNERABILITY TRIGGERS ARE A GRANULARITY LADDER.
//
// Each one says how COARSE a message is, and the scope follows from that. There
// is no separate scope setting: choosing the trigger is the whole configuration,
// which is why this replaced the three per-row checkboxes an earlier revision
// had. A row may carry any combination; two of them simply means the same
// findings arrive twice, at two granularities, which is an explicit choice.
//
// One message per COMPONENT. The shipped contract, and the original one:
// `data.componentKey` is a scalar in the ts-webhook worker, which
// renders it for slack / teams / teamsWorkflow. Left exactly as it was so the
// rows customers already created keep behaving identically.
const TRIGGER_VULNERABILITY = 'vulnerability';
// One message per MODULE.
const TRIGGER_VULNERABILITIES_BY_MODULE = 'vulnerabilitiesByModule';
// One message per PROJECT - the coarsest project-scope option.
const TRIGGER_VULNERABILITIES_BY_PROJECT = 'vulnerabilitiesByProject';
// One message per RELEASE. The ONLY trigger that watches the release scope, i.e.
// new CVEs measured against a release's own frozen snapshot rather than against
// the project's current components.
const TRIGGER_VULNERABILITIES_BY_RELEASE = 'vulnerabilitiesByRelease';

// Every trigger that asks for vulnerability alerts at all.
const VULNERABILITY_TRIGGERS = [
  TRIGGER_VULNERABILITY,
  TRIGGER_VULNERABILITIES_BY_MODULE,
  TRIGGER_VULNERABILITIES_BY_PROJECT,
  TRIGGER_VULNERABILITIES_BY_RELEASE
];
// The three that watch the PROJECT scope, and the one that watches RELEASES.
const PROJECT_SCOPE_TRIGGERS = [
  TRIGGER_VULNERABILITY,
  TRIGGER_VULNERABILITIES_BY_MODULE,
  TRIGGER_VULNERABILITIES_BY_PROJECT
];
const RELEASE_SCOPE_TRIGGERS = [TRIGGER_VULNERABILITIES_BY_RELEASE];

// Order is the order the dialog offers them in.
const WEBHOOK_TRIGGERS = [
  {value: 'analysis', label: 'Analysis'},
  {value: 'release', label: 'Release'},
  {value: TRIGGER_VULNERABILITY, label: 'Vulnerability'},
  {value: TRIGGER_VULNERABILITIES_BY_MODULE, label: 'Vulnerabilities by module'},
  {value: TRIGGER_VULNERABILITIES_BY_PROJECT, label: 'Vulnerabilities by project'},
  {value: TRIGGER_VULNERABILITIES_BY_RELEASE, label: 'Vulnerabilities in releases'},
  {value: 'approval', label: 'Approval'},
  {value: 'task', label: 'Task'}
];

const WEBHOOK_TRIGGER_VALUES = WEBHOOK_TRIGGERS.map(function (entry) {
  return entry.value;
});

// THE RECEIVER TYPES, same story as the triggers above.
//
// `toTitleCase` upper-cases the first character and LOWER-CASES the remainder,
// so the shipped `teamsWorkflow` type renders as 'Teamsworkflow' in the Type
// column of both list pages. The stored values stay as they are - renaming one
// would orphan every webhook row a customer has already created.
//
// `optionLabel` is what the Add-webhook dialog offers, which is deliberately
// wordier than a table cell should be (a deprecation date, an "under
// development" note); `label` is the column text. A type with no optionLabel
// uses its label in both places.
const WEBHOOK_TYPES = [
  {value: 'webhook', label: 'Webhook'},
  {value: 'teamsWorkflow', label: 'Microsoft Teams Workflow'},
  {value: 'slack', label: 'Slack'},
  {value: 'teams', label: 'Microsoft Teams',
    optionLabel: 'Microsoft Teams O365 (Deprecated - October 1st, 2024)'},
  {value: 'gitter', label: 'Gitter',
    optionLabel: 'Gitter (Under development)', disabled: true}
];

const WEBHOOK_TYPE_VALUES = WEBHOOK_TYPES.map(function (entry) {
  return entry.value;
});

/**
 * The display label for a stored receiver type.
 *
 * Unknown values are echoed VERBATIM, for the same reason as
 * webhookTriggerLabel below: a row from a future release or a hand-edited
 * document should look wrong, not look tidy.
 *
 * @param {String} value the stored type
 * @returns {String}
 */
function webhookTypeLabel(value) {
  const type = String(value === undefined || value === null ? '' : value);
  const known = WEBHOOK_TYPES.find(function (entry) {
    return entry.value === type;
  });
  return known ? known.label : type;
}

/**
 * The same list, shaped for the dialog's <option> elements.
 *
 * @returns {Array} {value, label, disabled}
 */
function webhookTypeOptions() {
  return WEBHOOK_TYPES.map(function (entry) {
    return {value: entry.value, label: entry.optionLabel || entry.label,
      disabled: !!entry.disabled};
  });
}

/**
 * The display label for a stored trigger value.
 *
 * A value that is not in the list is echoed VERBATIM rather than title-cased:
 * an unknown trigger is either a row from a future release or a hand-edited
 * document, and mangling its spelling would hide that instead of showing it.
 *
 * @param {String} value the stored trigger
 * @returns {String}
 */
function webhookTriggerLabel(value) {
  const trigger = String(value === undefined || value === null ? '' : value);
  const known = WEBHOOK_TRIGGERS.find(function (entry) {
    return entry.value === trigger;
  });
  return known ? known.label : trigger;
}

/**
 * The Triggers column's cell text for one webhook row.
 *
 * @param {Array} triggers the stored `triggers` array
 * @returns {String}
 */
function webhookTriggersLabel(triggers) {
  if (!Array.isArray(triggers) || !triggers.length) {
    return '';
  }
  return triggers.map(webhookTriggerLabel).join(', ');
}

module.exports = {
  WEBHOOK_TYPES,
  WEBHOOK_TYPE_VALUES,
  webhookTypeLabel,
  webhookTypeOptions,
  TRIGGER_VULNERABILITY,
  TRIGGER_VULNERABILITIES_BY_MODULE,
  TRIGGER_VULNERABILITIES_BY_PROJECT,
  TRIGGER_VULNERABILITIES_BY_RELEASE,
  VULNERABILITY_TRIGGERS,
  PROJECT_SCOPE_TRIGGERS,
  RELEASE_SCOPE_TRIGGERS,
  WEBHOOK_TRIGGERS,
  WEBHOOK_TRIGGER_VALUES,
  webhookTriggerLabel,
  webhookTriggersLabel
};

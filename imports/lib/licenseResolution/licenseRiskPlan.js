// The identity and the name of the Risk a manual license resolution files,
// in the same shape as SARIF-derived risks.
//
// Nothing here reads or writes the database; the server interactor
// (imports/lib/interactors/riskProperties/reconcileLicenseRisk.js) is the only
// thing that does. Plain CommonJS with no meteor/* imports so Jest requires it
// directly.
//
// WHY THE NAME NEEDS ITS OWN FILTER
//
// Both segments of the name are scanner or user content, and RiskSchema.name
// carries two anti-XSS regexes plus a 200-character bound. A generated name that
// trips either fails collection2 INSIDE the insert - so the resolution would
// succeed, the risk would never appear, and the only trace would be a
// console.error. The filter is not decoration.

const {escapeKeySegment, AUTO_KEY_MAX, RISK_NAME_MAX} = require('../sarif/cweRiskPlan');

const LICENSE_RISK_AUTO_KEY_PREFIX = 'lic-unmatched';
const AUTO_KEY_SEPARATOR = '|';

// The origin enum member these risks carry. Declared here so the planner and the
// writer agree; the canonical list is riskProperties/riskOrigin.js, which
// license-risk-plan.unit.spec.js pins this against.
const LICENSE_RISK_ORIGIN = 'LIC';

// Unlike cweRiskPlan's toolLabel, `:` and `/` and `@` ARE in the allow-list:
// every real component key spells them (`npm:@angular/core`,
// `maven:org.apache.commons:commons-lang3`), and stripping them would make every
// risk name unreadable. `,`, CR/LF and `=` stay out - Company Logs is exported
// to CSV with `quotes: false`, so a key carrying one of those would forge a row
// or a spreadsheet formula in the export.
const SAFE_SEGMENT = /[^A-Za-z0-9 ._+/@():-]/g;

// RiskSchema.name's two regexes, verbatim. Keeping `:` means `javascript:` can
// survive the character filter, so the result is RE-TESTED against them; without
// this the insert fails and the feature silently produces nothing.
// eslint-disable-next-line sonarjs/regex-complexity
const NAME_NO_SCRIPT = /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/;
const NAME_REGEXES = [/^[^<>]*$/, NAME_NO_SCRIPT];

// Not "unknown": the segment IS known, it just cannot be rendered safely, and
// saying so is more honest than pretending the value was missing.
const UNSAFE_SEGMENT_LABEL = 'an unsupported value';

/**
 * A component key or a license key, reduced to something RiskSchema.name accepts.
 *
 * @param {String} value the raw segment
 * @returns {String} a storable segment, never empty
 */
function safeRiskNameSegment(value) {
  const filtered = String(value === undefined || value === null ? '' : value)
    .replace(SAFE_SEGMENT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!filtered) {
    return UNSAFE_SEGMENT_LABEL;
  }
  // LOWER-CASED before the re-test, deliberately stricter than the schema:
  // RiskSchema.name's `javascript\s*:` guard is case-sensitive, so `JavaScript :`
  // would be stored verbatim - and a browser resolving an href does not care
  // about the case. Rejecting it here costs nothing (no real component or license
  // key spells it) and keeps a stored risk name from ever carrying the string.
  const probe = filtered.toLowerCase();
  return NAME_REGEXES.every(function (re) { return re.test(probe); }) ?
    filtered : UNSAFE_SEGMENT_LABEL;
}

/**
 * 'lic-unmatched|<moduleId>|<componentKey>'.
 *
 * companyId is deliberately absent - a moduleId already implies exactly one
 * company - but every selector built from this key still carries companyId for
 * defence in depth. BOTH variable segments go through the same escape as the
 * SARIF key: a component key is scanner content and may legally contain `|`.
 *
 * Returns null rather than a key that could not be stored: escaping can triple a
 * segment's length, which would overflow RiskPropertiesSchema.autoKey and fail
 * the insert after the work was already done. The caller turns a null into
 * `risk: 'skipped'` and still completes the resolution.
 *
 * @param {String} moduleId the module the component belongs to
 * @param {String} componentKey the component whose license was set manually
 * @returns {String|null} the identity key, or null when it would not fit
 */
function buildLicenseRiskAutoKey(moduleId, componentKey) {
  if (typeof moduleId !== 'string' || !moduleId) {
    return null;
  }
  if (typeof componentKey !== 'string' || !componentKey) {
    return null;
  }
  const key = [LICENSE_RISK_AUTO_KEY_PREFIX, escapeKeySegment(moduleId),
    escapeKeySegment(componentKey)].join(AUTO_KEY_SEPARATOR);
  return key.length > AUTO_KEY_MAX ? null : key;
}

// The fixed middle of a license risk name. "to", not "as", so the register reads
// the same as the aside's "Set manually to MIT.".
const NAME_MIDDLE = '] License set manually to ';
// 1 for the opening bracket.
const NAME_FIXED = 1 + NAME_MIDDLE.length;
// What a cut segment ends with. A cut MUST stay visibly incomplete: slicing
// `GPL-3.0-or-later` down to `GPL-3.0` yields a DIFFERENT, perfectly valid
// licence identifier, permanently, in an audit record. Three dots are inside
// SAFE_SEGMENT's allow-list, so they survive the filter that follows nothing.
const NAME_CUT = '...';
// A cut component key still has to tell one row of the risk register from
// another, so the licence can never claim the whole budget.
const NAME_KEY_MIN = 12;

// `segment`, guaranteed to fit `budget`, and unmistakably marked when it did not.
// Both budgets below are >= NAME_KEY_MIN by construction, so the slice is always
// wide enough for the mark plus something to read.
function cutToBudget(segment, budget) {
  if (segment.length <= budget) {
    return segment;
  }
  let kept = segment.slice(0, Math.max(budget - NAME_CUT.length, 1));
  // A slice can land on the space between two words, and `word ...` reads worse
  // than `word...`. safeRiskNameSegment has already collapsed every run of
  // whitespace to one plain space and trimmed, so at most one can be here - the
  // loop is a character walk rather than a `\s+$` regex, which backtracks
  // quadratically on a long whitespace run.
  while (kept.length > 1 && kept.charAt(kept.length - 1) === ' ') {
    kept = kept.slice(0, -1);
  }
  return kept + NAME_CUT;
}

/**
 * '[npm:left-pad] License set manually to MIT'.
 *
 * "set manually", never "resolved": in the dependency aside "Resolved" already
 * means "a legal rule whose risk a manager accepted", and reusing it would tell
 * a compliance manager they accepted a risk when they only recorded a fact.
 *
 * THE LICENCE IS BUDGETED FIRST. A component key is accepted up to 250
 * characters and RiskSchema.name holds 200, so slicing the finished string -
 * which is what this used to do - truncates the tail: a
 * long `golang:github.com/...` key turned `GPL-3.0-or-later` into `GPL-3.0`, or
 * dropped the licence from the name altogether. The variable half that may be
 * cut is the key, and a cut is always marked.
 *
 * A deterministic function of the pair, which is what lets the update branch ask
 * "does the stored name still equal the one we would have written?" before it
 * rewrites a name a human may have edited.
 *
 * @param {String} componentKey the component
 * @param {String} license the license key that was picked
 * @returns {String} a name RiskSchema will accept
 */
function buildLicenseRiskName(componentKey, license) {
  // A private license key is never checked against SPDX (privateLicenses.create
  // does not), so it can be longer than the whole name. It gets a budget too -
  // and the same visible mark, so it can never read as a licence that exists.
  const licenseSegment = cutToBudget(safeRiskNameSegment(license),
    RISK_NAME_MAX - NAME_FIXED - NAME_KEY_MIN);
  const keySegment = cutToBudget(safeRiskNameSegment(componentKey),
    RISK_NAME_MAX - NAME_FIXED - licenseSegment.length);
  return '[' + keySegment + NAME_MIDDLE + licenseSegment;
}

module.exports = {
  LICENSE_RISK_AUTO_KEY_PREFIX,
  LICENSE_RISK_ORIGIN,
  UNSAFE_SEGMENT_LABEL,
  buildLicenseRiskAutoKey,
  buildLicenseRiskName,
  safeRiskNameSegment
};

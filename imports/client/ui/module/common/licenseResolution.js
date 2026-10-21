// Pure decision logic for the manual license resolution of unmatched
// components.
//
// Deliberately plain CommonJS with NO `meteor/*` imports, so `yarn test` can
// execute it for real under the Jest harness in test_api/ - the Blaze
// templates that consume it (component-license-resolve.js,
// module-dependencies-aside.js) cannot be required there. Everything that
// decides WHICH state the aside renders, and everything the UI must check
// before it calls the server, lives here rather than in a helper.
//
// The stored entry shape (written by Modules.ResolveComponentLicense) is
//   {key, license, comment, justification, resolvedBy, resolvedById, resolvedAt}
// and `justification` is the DISCRIMINATOR: entries written by the
// multi-license modal and by the root component picker carry none, and must be
// invisible to every function here.

// Mirrors the server-side cap; the server measures the RAW string, so we do too.
const JUSTIFICATION_MAX_LENGTH = 2000;

const STATE_RESOLVED = 'resolved';
const STATE_NO_LICENSE = 'unmatched-no-license';
const STATE_REASON = 'unmatched-reason';
const STATE_NONE = 'none';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The manual-resolution entry for one component, or null.
 *
 * Only entries carrying a non-empty justification are ours. A multi-license or
 * root-picker entry for the same key is ignored, so undo can never delete one
 * and the green record can never show one component's justification under
 * another component.
 *
 * @param {Array} licensesSelected module.componentConfig.licensesSelected
 * @param {string} componentKey
 * @returns {Object|null}
 */
function findResolutionEntry(licensesSelected, componentKey) {
  if (!Array.isArray(licensesSelected) || !isNonEmptyString(componentKey)) return null;
  for (let i = 0; i < licensesSelected.length; i++) {
    const entry = licensesSelected[i];
    if (entry && typeof entry === 'object' &&
      entry.key === componentKey && isNonEmptyString(entry.justification)) {
      return entry;
    }
  }
  return null;
}

// The licenses recorded on one dependency path, whichever of the two shapes the
// caller holds: the descriptor straight out of the analysis document
// (`{path, licenses}`), or the wrapper `licenseResolutionContext` builds around
// it (`{licenseCount, reason, path: <descriptor>, version}`).
function licensesOfPath(pathCtx) {
  if (!pathCtx) return [];
  const nested = pathCtx.path && pathCtx.path.licenses;
  if (Array.isArray(nested)) return nested;
  return Array.isArray(pathCtx.licenses) ? pathCtx.licenses : [];
}

/**
 * The analyzer's own explanation for a license it matched but is not confident
 * about, taken from the licenses of ONE dependency path (AC#2).
 *
 * The stored field is `license.status.reason`. `licenseStatus` is a Blaze HELPER
 * name in module-dependencies-aside.js - it returns `status` decorated with the
 * policy-adjusted `computedStatus` - and NOT a field of the analysis document,
 * so `license.licenseStatus.reason` reads undefined for every component ever
 * stored and silently turns trigger state (b) off entirely. Extraction lives
 * here, and not in a Blaze helper, precisely so a test can execute it against
 * the real stored shape.
 *
 * @param {Array} licenses `path.licenses` from the analysis document
 * @returns {string} the first non-empty reason, or ''
 */
function extractPathReason(licenses) {
  if (!Array.isArray(licenses)) return '';
  for (let i = 0; i < licenses.length; i++) {
    const license = licenses[i];
    const reason = license && license.status && license.status.reason;
    if (isNonEmptyString(reason)) return reason;
  }
  return '';
}

/**
 * Every policy verdict recorded for ONE license key across a component's
 * dependency paths, ready for `worstPolicyStatus`.
 *
 * Same field trap as `extractPathReason`: the verdict hangs off
 * `license.status`, not off a `licenseStatus` field that does not exist.
 *
 * The allow/deny evaluation itself needs the module, project and company
 * documents, so it is INJECTED rather than imported - this module stays free of
 * `meteor/*`. `status.computedStatus`, when the dependency aside has already
 * written it onto the shared status object, is preferred so both surfaces show
 * the same verdict; it is never relied upon, because those sections render below
 * this one and have not run yet on a first render.
 *
 * @param {Array} paths path descriptors or context wrappers
 * @param {string} licenseKey the manually set license
 * @param {Function} [computeStatus] (licenseKey, status) -> {status: '...'}
 * @returns {Array<string>} one analyzer status per matching path license
 */
function collectPolicyStatuses(paths, licenseKey, computeStatus) {
  const statuses = [];
  if (!Array.isArray(paths) || !isNonEmptyString(licenseKey)) return statuses;
  for (let i = 0; i < paths.length; i++) {
    const licenses = licensesOfPath(paths[i]);
    for (let j = 0; j < licenses.length; j++) {
      const license = licenses[j];
      const status = license && license.key === licenseKey && license.status;
      if (!status) continue;
      let computed = status.computedStatus;
      if (!computed && typeof computeStatus === 'function') {
        computed = computeStatus(licenseKey, status);
      }
      if (computed && isNonEmptyString(computed.status)) statuses.push(computed.status);
    }
  }
  return statuses;
}

// Accepts either a component context carrying `paths`, or a single path
// descriptor - the component-level section aggregates every path, while the
// per-path blocks ask about one path at a time.
function pathsOf(ctx) {
  if (!ctx) return [];
  if (Array.isArray(ctx.paths)) return ctx.paths;
  return [ctx];
}

function hasNoLicenses(pathCtx) {
  if (!pathCtx) return true;
  const count = pathCtx.licenseCount;
  return !(typeof count === 'number' && count > 0);
}

/**
 * Which of the four aside states applies.
 *
 * 'resolved'              - a manual resolution exists; render the green record.
 * 'unmatched-no-license'  - at least one path carries no license at all (AC#1).
 * 'unmatched-reason'      - a license was matched but the analyzer is not
 *                           confident about it (AC#2).
 * 'none'                  - a license is present with no reason; the control is
 *                           NOT offered (AC#3), the multi-license modal owns it.
 *
 * A resolution wins over every unmatched state, so the green record replaces
 * the yellow block even while the analysis still reports nothing (AC#12).
 * When paths disagree, "no license at all" wins: it is the harder dead end and
 * the state the user story describes.
 *
 * @param {Object} ctx {componentKey, paths:[{licenseCount, reason}]} or
 *                     {componentKey, licenseCount, reason}
 * @param {Array} licensesSelected module.componentConfig.licensesSelected
 * @returns {string}
 */
function resolutionState(ctx, licensesSelected) {
  if (!ctx || !isNonEmptyString(ctx.componentKey)) return STATE_NONE;
  if (findResolutionEntry(licensesSelected, ctx.componentKey)) return STATE_RESOLVED;

  const paths = pathsOf(ctx);
  if (!paths.length) return STATE_NONE;
  for (let i = 0; i < paths.length; i++) {
    if (hasNoLicenses(paths[i])) return STATE_NO_LICENSE;
  }
  for (let i = 0; i < paths.length; i++) {
    if (paths[i] && isNonEmptyString(paths[i].reason)) return STATE_REASON;
  }
  return STATE_NONE;
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return date.toLocaleDateString();
}

/**
 * The four fields the green record displays, or null when the entry is not
 * ours. The caller renders these as text - nothing here is HTML.
 *
 * @param {Object} entry a licensesSelected entry
 * @returns {{license: string, justification: string, author: string, date: string}|null}
 */
function resolutionView(entry) {
  if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.justification)) return null;
  return {
    license: entry.license || '',
    justification: entry.justification,
    author: entry.resolvedBy || '',
    date: formatDate(entry.resolvedAt)
  };
}

/**
 * The UI's own justification check, mirroring the server's validation order so
 * a blocked save never reaches the network (AC#9).
 *
 * @param {*} text
 * @returns {boolean}
 */
function isJustificationValid(text) {
  if (typeof text !== 'string') return false;
  if (text.length > JUSTIFICATION_MAX_LENGTH) return false;
  return text.trim().length >= 1;
}

/**
 * True when an analysis finished AFTER the resolution was recorded and still
 * reports no license for the component - the manual selection was not picked
 * up. Rendered as the "Not applied" sub-section; without it the failure is
 * silent and the user is told a license is set that nothing is using.
 *
 * @param {Object} entry the manual-resolution entry
 * @param {Date|string|null} analysisDate when the latest analysis ran
 * @param {boolean} hasLicense whether that analysis found any license
 * @returns {boolean}
 */
function isStaleResolution(entry, analysisDate, hasLicense) {
  if (hasLicense) return false;
  if (!entry || !isNonEmptyString(entry.justification) || !entry.resolvedAt) return false;
  if (!analysisDate) return false;
  const analysed = analysisDate instanceof Date ? analysisDate : new Date(analysisDate);
  const resolved = entry.resolvedAt instanceof Date ? entry.resolvedAt : new Date(entry.resolvedAt);
  if (isNaN(analysed.getTime()) || isNaN(resolved.getTime())) return false;
  return analysed.getTime() > resolved.getTime();
}

// Worst-first, so a component whose license is clean on one path and denied on
// another reads as denied. Anything the analyzer did not produce a status for
// is NOT ranked - it becomes 'pending', never a guessed verdict.
const POLICY_RANK = ['ok', 'warnings', 'violations'];

// Singular, matching the status dropdown in the SAME aside
// (module-dependencies-aside.html: OK / Warning / Violation). The keys stay
// plural because they are the analyzer's own status values.
const POLICY_WORDS = {
  ok: 'OK',
  warnings: 'Warning',
  violations: 'Violation',
  pending: 'Pending'
};

/**
 * The policy verdict to display for a manually set license, from the statuses
 * the analyzer computed for that license on each of the component's paths.
 *
 * Returns 'pending' when the analyzer has said nothing yet - between the save
 * and the next analysis run there IS no verdict, and inventing one is the whole
 * failure mode this feature has to avoid (AC#13).
 *
 * @param {Array<string>} statuses analyzer statuses, one per path
 * @returns {string} 'ok' | 'warnings' | 'violations' | 'pending'
 */
function worstPolicyStatus(statuses) {
  if (!Array.isArray(statuses)) return 'pending';
  let worst = -1;
  for (let i = 0; i < statuses.length; i++) {
    const rank = POLICY_RANK.indexOf(statuses[i]);
    if (rank > worst) worst = rank;
  }
  return worst === -1 ? 'pending' : POLICY_RANK[worst];
}

/**
 * The word shown on the Policy status line. Status is always conveyed as a
 * word; the colour beside it is decorative only.
 *
 * @param {string} status
 * @returns {string}
 */
function policyStatusWord(status) {
  return Object.prototype.hasOwnProperty.call(POLICY_WORDS, status) ?
    POLICY_WORDS[status] : POLICY_WORDS.pending;
}

module.exports = {
  JUSTIFICATION_MAX_LENGTH,
  STATE_RESOLVED,
  STATE_NO_LICENSE,
  STATE_REASON,
  STATE_NONE,
  findResolutionEntry,
  extractPathReason,
  collectPolicyStatuses,
  resolutionState,
  resolutionView,
  isJustificationValid,
  isStaleResolution,
  worstPolicyStatus,
  policyStatusWord
};

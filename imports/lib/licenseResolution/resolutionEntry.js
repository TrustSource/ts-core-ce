// What a manual license resolution IS: the validation of the four
// arguments the method accepts, the entry stored on
// `module.componentConfig.licensesSelected`, and the "nothing changed" test that
// makes a resubmit free.
//
// Every DECISION lives here; the interactor
// (imports/lib/interactors/modules/resolveComponentLicense.js) only does the
// database work. Plain CommonJS with no meteor/* imports so Jest requires it
// directly and the picker can share the bounds.
//
// THE DISCRIMINATOR
//
// `licensesSelected` is a shared array: the multi-license modal and the
// root-component picker both write into it, and neither carries a
// `justification`. That field is what marks an entry as ours - it alone drives
// the per-dependency injection, the "License set manually" panel and undo. An
// entry without one is never injected per node and is never deleted by undo.

const {userDisplayName} = require('../user/displayName');

// The module id goes straight into a Mongo selector. Meteor's own _id is 17
// characters; the bound is generous and exists so a caller cannot make the
// selector arbitrarily large.
const MODULE_ID_MAX = 64;
// Mirrors SelectedLicensesEntrySchema.key.max - the field this entry's key is
// actually WRITTEN to. That schema declared 100 while every sibling component-key
// field of the same componentConfig (BWComponentEntrySchema.key, used by
// whitelist/blacklist/unchanged/looseCoupled/changedStatus, and
// CustomComponentSchema.key) declared 250, so a 101-250 character key - ordinary
// scanner content, `golang:github.com/<org>/<repo>/<deep>/<path>` - stored fine
// (Modules has no attached schema) and then 400ed the next REST module POST that
// supplied componentConfig. The schema was raised to match its siblings rather
// than this bound lowered: lowering would leave every already-stored long key
// unwritable AND make those components permanently unresolvable.
const COMPONENT_KEY_MAX = 250;
// Mirrors SelectedLicensesEntrySchema.license/key bound for a LICENSE key.
const LICENSE_KEY_MAX = 100;
// How many entries componentConfig.licensesSelected may hold, for every writer.
// A resolution entry carries up to 2000 characters of free text plus the author
// fields - roughly ten times what a multi-license pick costs - so an uncapped
// array reaches the 16MB BSON limit and makes the module document unwritable by
// anything, including the code that would remove the entries. Declared here so
// the schema (imports/lib/schemas/moduleSchema.js) and the method that appends
// share one number.
const LICENSES_SELECTED_MAX = 2000;
// The justification is stored verbatim on a document that also holds the whole
// component configuration, so it carries its own bound. Enforced on the RAW
// length: what gets stored is what the user typed.
const JUSTIFICATION_MAX = 2000;

// SelectedLicensesEntrySchema.comment is `min: 1, max: 200` and NOT optional, so
// an entry without one would 400 a REST module PUT. The real audit text lives in
// `justification`; this is the one-line label the existing views already render.
const RESOLUTION_COMMENT = 'License set manually';

// A user could not be resolved to any name at all - a state userDisplayName can
// legitimately return '' for, and a blank author in the panel reads as a bug.
//
// NOT 'unknown'. This string is PERSISTED and reaches REST consumers, and the
// panel renders `Set by {resolvedBy}` a few lines under `<b>UNKNOWN</b>` when
// that catch-all key was the licence picked - so the short form reads as the
// licence identifier rather than as a person. A phrase reads correctly
// mid-sentence, cannot be mistaken for a key, and cannot be mistaken for a name.
const UNKNOWN_AUTHOR = 'an unidentified user';

const INVALID = 'Invalid arguments';
const JUSTIFICATION_REQUIRED = 'Justification required';

function isUsableString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/**
 * The two identifiers every method of this feature takes. Shared so the undo
 * path cannot end up with a second, drifting copy of the bounds.
 *
 * @param {Object} input {moduleId, componentKey}
 * @returns {Object} {ok: true} or {ok: false, reason}
 */
function validateComponentTarget(input) {
  const params = input || {};
  if (!isUsableString(params.moduleId, MODULE_ID_MAX)) {
    return {ok: false, reason: INVALID};
  }
  if (!isUsableString(params.componentKey, COMPONENT_KEY_MAX)) {
    return {ok: false, reason: INVALID};
  }
  return {ok: true};
}

/**
 * Whether the four arguments are acceptable, and why not when they are not.
 *
 * Checked in the declared order so the caller is always told about the FIRST
 * problem: the reason is a fixed literal that reaches the browser, and it must
 * never depend on which of the caller's values the server happened to look at
 * last. The license is checked for SHAPE only - resolving it against the
 * catalogue needs the caller's company and therefore happens in the interactor,
 * after the authorization gates.
 *
 * @param {Object} input {moduleId, componentKey, license, justification}
 * @returns {Object} {ok: true} or {ok: false, reason}
 */
function validateResolutionInput(input) {
  const params = input || {};
  const target = validateComponentTarget(params);
  if (!target.ok) {
    return target;
  }
  if (!isUsableString(params.license, LICENSE_KEY_MAX)) {
    return {ok: false, reason: INVALID};
  }
  if (typeof params.justification !== 'string' ||
      params.justification.length > JUSTIFICATION_MAX) {
    return {ok: false, reason: INVALID};
  }
  // Its own reason: "you left the box empty" is a different thing to tell a user
  // than "your request was malformed", and the frontend renders them differently.
  if (!params.justification.trim().length) {
    return {ok: false, reason: JUSTIFICATION_REQUIRED};
  }
  return {ok: true};
}

/**
 * The entry stored on the module. `version` is deliberately absent - a
 * resolution is per (module, component key) and covers every version of that
 * component in the module (product decision 4), which is why
 * SelectedLicensesEntrySchema.version had to become optional.
 *
 * @param {Object} input {componentKey, license, justification, user, now}
 * @returns {Object} the licensesSelected entry
 */
function buildResolutionEntry(input) {
  const params = input || {};
  const user = params.user || {};
  return {
    key: params.componentKey,
    license: params.license,
    comment: RESOLUTION_COMMENT,
    // VERBATIM. It is an audit record: trimming it would make an identical
    // resubmit read as a change, and escaping it would corrupt what was written.
    // Everything that renders it escapes at render time.
    justification: params.justification,
    resolvedBy: userDisplayName(user) || UNKNOWN_AUTHOR,
    resolvedById: user._id,
    resolvedAt: params.now instanceof Date ? params.now : new Date()
  };
}

function selectedEntries(module) {
  const config = (module && module.componentConfig) || {};
  return Array.isArray(config.licensesSelected) ? config.licensesSelected : [];
}

/**
 * How many entries componentConfig.licensesSelected currently holds.
 *
 * @param {Object} module a module document
 * @returns {Number} the entry count, 0 for anything malformed
 */
function selectedEntryCount(module) {
  return selectedEntries(module).length;
}

function hasJustification(entry) {
  return !!(entry && typeof entry.justification === 'string' &&
    entry.justification.trim().length > 0);
}

/**
 * The licensesSelected entry for a component key, whoever wrote it - but OURS
 * first when there is one.
 *
 * FILTER, THEN FIRST. `licensesSelected` carries no uniqueness constraint on
 * `key` and is written wholesale by `updateCollection` and by the REST module
 * POST, so two entries for one component key are storable. Taking the first
 * entry FOR THE KEY and only then asking whether it is ours answers `null` for a
 * component that demonstrably carries a resolution, which is a different answer
 * to the one the client (findResolutionEntry) and the injection
 * (componentLicensePick's resolvedLicenseMap) give: the aside then renders the
 * "License set manually" panel with an Undo button that removes nothing, for
 * ever.
 *
 * The fallback keeps the "whoever wrote it" meaning the resolve method needs to
 * tell "I am replacing an entry" from "I am appending one".
 *
 * @param {Object} module a module document
 * @param {String} componentKey the component key
 * @returns {Object|null} the entry, or null
 */
function findSelectedEntry(module, componentKey) {
  if (typeof componentKey !== 'string' || !componentKey) return null;
  const forKey = selectedEntries(module).filter(function (entry) {
    return entry && entry.key === componentKey;
  });
  return forKey.find(hasJustification) || forKey[0] || null;
}

/**
 * The entry for a component key that THIS feature wrote - i.e. one carrying a
 * justification. Undo and the "License set manually" panel both key on it, so a
 * multi-license-modal pick or a root-picker pick for the same component can
 * never be deleted or claimed by this feature.
 *
 * @param {Object} module a module document
 * @param {String} componentKey the component key
 * @returns {Object|null} the resolution entry, or null
 */
function findResolution(module, componentKey) {
  const entry = findSelectedEntry(module, componentKey);
  return hasJustification(entry) ? entry : null;
}

/**
 * Whether re-submitting `next` would change anything that is stored.
 *
 * Only the license and the justification are compared. The author and the
 * timestamp are DELIBERATELY excluded: Meteor re-sends an outstanding method
 * call on reconnect and a user can click Save twice, and neither
 * may rewrite the audit trail. A stored entry that is not one of ours (no
 * justification) always counts as changed - resolving that component gives it an
 * audit trail it did not have.
 *
 * @param {Object} existing the stored licensesSelected entry, if any
 * @param {Object} next the entry buildResolutionEntry just produced
 * @returns {Boolean} true when no write is needed
 */
function isResolutionUnchanged(existing, next) {
  if (!hasJustification(existing) || !next) return false;
  return existing.license === next.license && existing.justification === next.justification;
}

// The four fields Modules.ResolveComponentLicense OWNS. They are the audit
// record - who determined this license, when, and on what written grounds - and
// the method that writes them is gated on compliance_manager|manager.
const RESOLUTION_AUDIT_FIELDS = ['justification', 'resolvedBy', 'resolvedById', 'resolvedAt'];

const AUDIT_FIELD_SET = new Set(RESOLUTION_AUDIT_FIELDS);

// Every object built here is keyed by strings out of a REST request body, and
// JSON.parse - which is what the body parser produces - DOES create an own
// `__proto__` key. `out[key] = value` on such a key runs Object.prototype's
// setter instead of storing anything, so the field silently vanishes from the
// copy while the copy's prototype is reassigned. Same hasOwn/setOwn pair
// imports/lib/interactors/riskProperties/managedFields.js established for
// exactly this input class.
function setOwn(target, key, value) {
  Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true});
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function withoutAuditFields(entry) {
  if (!isPlainObject(entry)) {
    return entry;
  }
  const out = {};
  Object.keys(entry).forEach(function (field) {
    if (!AUDIT_FIELD_SET.has(field)) {
      setOwn(out, field, entry[field]);
    }
  });
  return out;
}

/**
 * A copy of a client-supplied `componentConfig` with the resolution audit fields
 * removed from every licensesSelected entry.
 *
 * Declaring those four fields on SelectedLicensesEntrySchema is what made this
 * necessary: `filter` defaults to true in the vendored simple-schema, so before
 * they were declared `ModuleSchema.clean()` dropped them on the REST path and
 * they could not be written. Declared, they survive clean() and are written by
 * `$set: module` - which hands an API key carrying the LOWEST scope in the
 * product (`developer`) the ability to forge an authoritative audit record and
 * to steer any component's license, bypassing the role gate entirely.
 *
 * Non-mutating, like managedFields' stripManagedRiskFields, which the update
 * path runs for the same reason.
 *
 * @param {Object} componentConfig the caller's componentConfig, whatever it is
 * @returns {Object} a cleaned copy, or the value unchanged when there is nothing
 *   of ours in it
 */
function stripResolutionAudit(componentConfig) {
  if (!isPlainObject(componentConfig) || !Array.isArray(componentConfig.licensesSelected)) {
    return componentConfig;
  }
  const out = {};
  Object.keys(componentConfig).forEach(function (field) {
    setOwn(out, field, componentConfig[field]);
  });
  setOwn(out, 'licensesSelected', componentConfig.licensesSelected.map(withoutAuditFields));
  return out;
}

/**
 * The inverse half of the same round trip: a copy of a client-supplied
 * componentConfig with the STORED audit trail put back on every entry the client
 * handed back unchanged.
 *
 * GET /api/v2/core/modules/:id returns componentConfig INCLUDING these four fields,
 * and that endpoint's own documentation tells clients to read-modify-write the
 * configs. Stripping on the way in without restoring therefore turns an ordinary
 * "read it, change the whitelist, write it back" integration into a silent
 * demolition of every manual resolution in the module: `justification` is the
 * discriminator, so the injection stops, the panel disappears, undo becomes a
 * permanent no-op and the LIC risk is orphaned - with no logEvent and no warning.
 * The strip has to refuse a FORGED record without deleting a REAL one.
 *
 * The licence is part of the match on purpose. Sending back a different
 * `license` for the key is a genuine change of the pick, made over a path with
 * no role check; carrying the old author across would say a compliance manager
 * determined a licence they never saw. That entry keeps the strip's result and
 * becomes a plain pick, which is what it now is.
 *
 * A matched entry is replaced by the STORED one WHOLE, not merged field by
 * field. Once key and license are pinned to what is stored, the only fields a
 * caller could still vary are `comment`, `version` and `path` - and `comment` is
 * the one-line label rendered beside the author. Taking the stored entry entire
 * means an entry this feature owns round-trips byte for byte or not at all,
 * which is a far easier property to hold than a list of fields to defend.
 *
 * @param {Object} componentConfig the caller's componentConfig, already stripped
 * @param {Array} storedEntries the module's stored licensesSelected
 * @returns {Object} a copy with the stored resolutions restored, or the value
 *   unchanged when there is nothing to restore
 */
function restoreResolutionAudit(componentConfig, storedEntries) {
  if (!isPlainObject(componentConfig) || !Array.isArray(componentConfig.licensesSelected)) {
    return componentConfig;
  }
  // A Map, not an object literal: a component key is scanner content and may
  // spell `__proto__` or `constructor`.
  const stored = new Map();
  (Array.isArray(storedEntries) ? storedEntries : []).forEach(function (candidate) {
    if (!hasJustification(candidate)) return;
    if (typeof candidate.key !== 'string' || !candidate.key) return;
    // First of ours wins, the same rule findSelectedEntry and the client's
    // findResolutionEntry apply.
    if (!stored.has(candidate.key)) {
      stored.set(candidate.key, candidate);
    }
  });
  if (!stored.size) {
    return componentConfig;
  }
  const out = {};
  Object.keys(componentConfig).forEach(function (field) {
    setOwn(out, field, componentConfig[field]);
  });
  setOwn(out, 'licensesSelected', componentConfig.licensesSelected.map(function (incoming) {
    if (!isPlainObject(incoming) || typeof incoming.key !== 'string') {
      return incoming;
    }
    const keep = stored.get(incoming.key);
    if (!keep || keep.license !== incoming.license) {
      return incoming;
    }
    const restored = {};
    Object.keys(keep).forEach(function (field) {
      setOwn(restored, field, keep[field]);
    });
    return restored;
  }));
  return out;
}

module.exports = {
  MODULE_ID_MAX,
  COMPONENT_KEY_MAX,
  LICENSE_KEY_MAX,
  JUSTIFICATION_MAX,
  LICENSES_SELECTED_MAX,
  RESOLUTION_COMMENT,
  RESOLUTION_AUDIT_FIELDS,
  UNKNOWN_AUTHOR,
  validateComponentTarget,
  validateResolutionInput,
  buildResolutionEntry,
  isResolutionUnchanged,
  findSelectedEntry,
  findResolution,
  hasJustification,
  selectedEntryCount,
  stripResolutionAudit,
  restoreResolutionAudit
};

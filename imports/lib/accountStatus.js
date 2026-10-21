// -----------------------------------------------------------------------------
// Account-status contract - UPDATES remain locked in ts-app.
//
// `accountStatus`, `accountStatusInfo` and `accountClearing` are top-level
// fields on the user document. All writes are owned by a SEPARATE admin
// application, which mutates the shared MongoDB directly from another process -
// ts-app must never update them and HARDENS them against any update that
// originates in this process (client DDP, server methods, REST). ts-app only
// READS these fields (to enforce suspension). `accountClearing` is no longer
// written by anything; it stays in the contract so existing documents validate.
//
// This module is isomorphic (no server-only imports) so both the shared schema
// (client + server validation) and the server-side write-lock / login guards can
// consume the same field names and helpers.
// -----------------------------------------------------------------------------

// Field shape is fixed by the shared-DB contract (do not change here):
//   accountStatus     (top-level): 'active' | 'suspicious' | 'suspended'
//   accountStatusInfo (top-level): {action, reason, at: Date, by: {userId, name}}
//   accountClearing   (top-level): {score, reason}
export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  SUSPICIOUS: 'suspicious',
  SUSPENDED: 'suspended'
};

export const ACCOUNT_STATUS_FIELD = 'accountStatus';
export const ACCOUNT_STATUS_INFO_FIELD = 'accountStatusInfo';
export const ACCOUNT_CLEARING_FIELD = 'accountClearing';

export const ACCOUNT_STATUS_LOCKED_FIELDS = [
  ACCOUNT_STATUS_FIELD,
  ACCOUNT_STATUS_INFO_FIELD,
  ACCOUNT_CLEARING_FIELD
];

/**
 * Normalised account status for a user document.
 *
 * Mirrors the admin app's semantics: only 'suspicious' and 'suspended' are
 * treated as distinct (access-restricting) states. Anything else - absent,
 * unknown, empty, or the literal 'active' - collapses to 'active' so a missing
 * field never accidentally locks a legitimate user out.
 *
 * @param {Object|null|undefined} user
 * @returns {'active'|'suspicious'|'suspended'}
 */
export function accountStatusOf(user) {
  const status = user && user[ACCOUNT_STATUS_FIELD];
  if (status === ACCOUNT_STATUS.SUSPICIOUS || status === ACCOUNT_STATUS.SUSPENDED) {
    return status;
  }
  return ACCOUNT_STATUS.ACTIVE;
}

// The first dot-segment of `key` is a locked field name.
// Guards against near-matches ('accountStatusExtra' -> top 'accountStatusExtra').
function keyTouchesLockedField(key) {
  if (typeof key !== 'string') {
    return false;
  }
  const top = key.split('.')[0];
  return ACCOUNT_STATUS_LOCKED_FIELDS.indexOf(top) !== -1;
}

/**
 * Pure predicate: does this Mongo update payload write a locked account-status
 * field, at any depth?
 *
 * Handles both shapes `update`/`updateAsync` may receive:
 *  - a Mongo operator object ($set / $unset / $setOnInsert / $inc / $rename /
 *    $push / ...): every operator's keys are inspected; for $rename the rename
 *    TARGET values are inspected too.
 *  - a replacement document (no $-prefixed top-level keys): its top-level keys
 *    are inspected.
 *
 * For every candidate field path the FIRST dot-segment is tested against
 * ACCOUNT_STATUS_LOCKED_FIELDS, so dotted sub-paths (e.g. 'accountClearing.score')
 * are caught even though the schema's blackbox sub-doc validation would skip them.
 *
 * @param {*} modifier
 * @returns {boolean}
 */
export function modifierTouchesAccountStatus(modifier) {
  if (!modifier || typeof modifier !== 'object') {
    return false;
  }
  const topKeys = Object.keys(modifier);
  const hasOperators = topKeys.some(function (k) {
    return k.charAt(0) === '$';
  });

  if (hasOperators) {
    for (const operator of topKeys) {
      const operand = modifier[operator];
      if (!operand || typeof operand !== 'object') {
        continue;
      }
      for (const field of Object.keys(operand)) {
        if (keyTouchesLockedField(field)) {
          return true;
        }
        // $rename: {source: target} - the target is also a write destination.
        if (operator === '$rename' && keyTouchesLockedField(operand[field])) {
          return true;
        }
      }
    }
    return false;
  }

  // Replacement document: top-level keys are the write destinations.
  for (const field of topKeys) {
    if (keyTouchesLockedField(field)) {
      return true;
    }
  }
  return false;
}

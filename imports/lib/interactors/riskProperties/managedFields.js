// The riskProperties.* fields the SARIF importer owns, and the code that keeps
// them out of a client-supplied modifier.
//
// `denyUpdate: true` is a NO-OP in this repo's vendored simple-schema, so this
// is the ONLY enforcement there is. Without it a client could:
//   * set `autoKey` and point an auto Risk at another module's identity, or
//     adopt one somebody else's import created;
//   * clear `autoKey` and make the next import mint a duplicate - the exact
//     failure this whole feature was asked to prevent;
//   * write `sourceRefs` and put evidence in the risk register that no scan ever
//     produced;
//   * write `autoLicense` and make the next manual license
//     resolution believe it already stored the license it is about to store, so
//     the risk silently stops tracking what the module actually says.
//
// Plain CommonJS with no imports, so Jest requires it directly and
// riskSchema.js can re-export UNTOUCHED_RISK_STATES to the client bundle the way
// it already re-exports RISK_ORIGIN_VALUES.

const MANAGED_RISK_PROPERTY_KEYS = ['autoKey', 'autoTool', 'autoCwe', 'autoLicense', 'sourceRefs',
  'sourceRefsTotal', 'sourceRefsTruncated', 'sourceRefsPrevCount'];

const MANAGED_RISK_FIELDS = MANAGED_RISK_PROPERTY_KEYS.map(function (key) {
  return 'riskProperties.' + key;
});

// A Risk in one of these states has been dealt with by a human, so an import
// refreshes nothing on it - not its sourceRefs, not its `edited` (AC26).
//
// Deliberately NOT RESOLVED_RISK_STATES: `eliminated`, `deferred` and `expired`
// DO get their evidence refreshed, because a weakness reappearing in a scan is
// exactly what somebody looking at an eliminated risk needs to see (AC27).
const UNTOUCHED_RISK_STATES = ['accepted', 'transferred', 'out-of-scope', 'closed'];

const RISK_PROPERTIES = 'riskProperties';
const MANAGED_KEY_SET = new Set(MANAGED_RISK_PROPERTY_KEYS);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Every output object here is keyed by strings out of a client-supplied
// modifier, and JSON.parse - which is what both DDP and the REST body parser
// produce - DOES create an own `__proto__` key. `out[key] = value` on such a key
// runs Object.prototype's setter instead of storing anything, so the forged
// field silently vanishes from the copy while the prototype of the output is
// reassigned. Same hasOwn/setOwn pair testImports/create.js already established
// for exactly this input class.
function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, {value, writable: true, enumerable: true, configurable: true});
}

// True for `riskProperties.autoKey`, `riskProperties.sourceRefs.0.count` and
// `riskProperties.sourceRefs.$.uri` alike: a write into a managed field is a
// write to it however it is spelled.
function isManagedPath(path) {
  if (typeof path !== 'string') {
    return false;
  }
  const segments = path.split('.');
  return segments.length > 1 && segments[0] === RISK_PROPERTIES && MANAGED_KEY_SET.has(segments[1]);
}

function isWholesalePath(path) {
  return path === RISK_PROPERTIES;
}

// Whether the caller's modifier replaces or removes the whole `riskProperties`
// subdocument. update.js asks this before reading the stored document, so the
// common case (a dotted single-field edit) costs no extra query.
function touchesRiskPropertiesWholesale(modifier) {
  if (!isPlainObject(modifier)) {
    return false;
  }
  return Object.keys(modifier).some(function (op) {
    const payload = modifier[op];
    if (op.charAt(0) !== '$') {
      return isWholesalePath(op);
    }
    return isPlainObject(payload) && Object.keys(payload).some(isWholesalePath);
  });
}

// A copy of a riskProperties value with every managed key removed, or
// `undefined` when there is nothing safe to return. Used on the create path,
// where there is no stored document to restore anything from.
//
// A NON-PLAIN-OBJECT payload is DROPPED rather than passed through. The shape
// that matters is an array - `{$set: {riskProperties: [{autoKey: '...'}]}}` -
// which has no keys this function would recognize as managed, so returning it
// untouched hands a forged identity straight to the collection. It fails closed
// today only because the vendored simple-schema rejects an array for an
// object-typed field, and that is the same package whose `denyUpdate` silently
// does nothing; immutability must not depend on it.
function stripManagedRiskProperties(riskProperties) {
  if (!isPlainObject(riskProperties)) {
    return undefined;
  }
  const out = {};
  Object.keys(riskProperties).forEach(function (key) {
    if (!MANAGED_KEY_SET.has(key)) {
      setOwn(out, key, riskProperties[key]);
    }
  });
  return out;
}

// A wholesale `$set: {riskProperties: {...}}` REPLACES the subdocument, so
// simply deleting the managed keys from the caller's object would delete them
// from the stored document too - the Risk would lose its identity and the next
// import would mint a duplicate. So the caller's managed keys are discarded and
// the STORED ones are put back.
//
// Deep-copied through JSON, because `sourceRefs` is an array of objects and the
// caller would otherwise be handed a reference into the document that was read.
// Returns `undefined` when the supplied value was dropped outright, which the
// callers turn into "leave the field out of the modifier altogether".
function restoreManagedRiskProperties(supplied, storedRiskProperties) {
  const out = stripManagedRiskProperties(supplied);
  if (out === undefined || !isPlainObject(storedRiskProperties)) {
    return out;
  }
  MANAGED_RISK_PROPERTY_KEYS.forEach(function (key) {
    if (hasOwn(storedRiskProperties, key)) {
      const value = storedRiskProperties[key];
      setOwn(out, key,
        value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);
    }
  });
  return out;
}

function cleanPayload(op, payload, storedRiskProperties) {
  const isRename = op === '$rename';
  const isUnset = op === '$unset';
  const out = {};
  Object.keys(payload).forEach(function (field) {
    // $rename is blocked on BOTH ends: renaming a managed field away removes it,
    // and renaming another field onto it forges it.
    if (isRename && (isManagedPath(field) || isWholesalePath(field) ||
        isManagedPath(payload[field]) || isWholesalePath(payload[field]))) {
      return;
    }
    if (isManagedPath(field)) {
      return;
    }
    if (isWholesalePath(field)) {
      if (isRename || isUnset) {
        // Both would take the identity with them.
        return;
      }
      const restored = restoreManagedRiskProperties(payload[field], storedRiskProperties);
      if (restored === undefined) {
        // A non-plain-object replacement (an array of forged fields, or a null
        // that would wipe the subdocument and its identity with it) is dropped,
        // not forwarded.
        return;
      }
      setOwn(out, field, restored);
      return;
    }
    setOwn(out, field, payload[field]);
  });
  return out;
}

// A cleaned copy of a client-supplied update modifier. `storedRiskProperties` is
// the riskProperties subdocument as it stands in the database, needed only when
// touchesRiskPropertiesWholesale(modifier) says so.
//
// Non-mutating, like sanitizeModifier, which this runs after.
function stripManagedRiskFields(modifier, storedRiskProperties) {
  if (!isPlainObject(modifier)) {
    return modifier;
  }
  const out = {};
  Object.keys(modifier).forEach(function (op) {
    const payload = modifier[op];
    if (op.charAt(0) !== '$') {
      // A bare field: a replacement document rather than an operator modifier.
      // The update path always adds a $set, so Mongo would reject the mix - but
      // cleaning it costs nothing and leaves no shape unguarded.
      if (isManagedPath(op)) {
        return;
      }
      if (isWholesalePath(op)) {
        const restored = restoreManagedRiskProperties(payload, storedRiskProperties);
        if (restored !== undefined) {
          setOwn(out, op, restored);
        }
        return;
      }
      setOwn(out, op, payload);
      return;
    }
    if (!isPlainObject(payload)) {
      setOwn(out, op, payload);
      return;
    }
    const cleaned = cleanPayload(op, payload, storedRiskProperties);
    // An operator whose whole payload was managed is dropped: Mongo rejects an
    // empty operator ("'$unset' is empty").
    if (Object.keys(cleaned).length) {
      setOwn(out, op, cleaned);
    }
  });
  return out;
}

module.exports = {
  MANAGED_RISK_FIELDS,
  MANAGED_RISK_PROPERTY_KEYS,
  UNTOUCHED_RISK_STATES,
  touchesRiskPropertiesWholesale,
  stripManagedRiskFields,
  stripManagedRiskProperties
};

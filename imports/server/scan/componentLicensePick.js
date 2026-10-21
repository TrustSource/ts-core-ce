// Applying a manually resolved component license to a stored scan.
//
// This is the generalisation of the root-only machinery in ./rootDependency.js
// from ONE node to an arbitrary set of nodes. Meteor-free CommonJS on purpose,
// same as its sibling: the walk decides where a per-company license key ends up
// inside a document the analyzer reads, and processScan.js cannot be required
// under Jest.
//
// TWO PROPERTIES CARRY THIS FILE.
//
// 1. NON-DESTRUCTIVE. `reprocessScan` reads the STORED scan and nothing anywhere
//    retains the original upload, so replacing a node's `licenses` wholesale -
//    the way applyRootLicense may, because it owns the root - would permanently
//    destroy the scanner's own declaration for an ordinary third-party package.
//    The pick is UNSHIFTED in front of what the scanner declared; only entries
//    this app itself injected are dropped first, so markers cannot accumulate
//    across runs.
//
// 2. NO LEAK. The entry carries COMPONENT_LICENSE_ORIGIN, and every write onto
//    the globally shared `components` catalogue filters marked entries
//    (processScan.js:373, :459 and the mapLicenseFromScanLicense guard at :529).
//    The license key is very often one of the company's PRIVATE keys, which
//    must never reach that catalogue.

const {componentPickLicense, isInjectedLicense} = require('./rootDependency');
const {MAX_STORABLE_DEPENDENCY_DEPTH} = require('./dependencyDepth');

/**
 * The picks a module carries, keyed by component key.
 *
 * ONLY entries carrying a `justification` are ours. `licensesSelected` is a
 * shared array - the multi-license modal and the root-component picker write
 * into it too - and injecting one of those per dependency would silently change
 * what the analyzer sees for a component nobody resolved.
 *
 * A Map, not an object literal: a component key comes out of a scan and may
 * spell `constructor` or `__proto__`.
 *
 * @param {Object} module a module document
 * @param {Object} [nameByKey] licenseKey -> display name, resolved by the caller
 *   with a single Licenses query (this module never touches the database)
 * @returns {Map} componentKey -> {license, name}
 */
function resolvedLicenseMap(module, nameByKey) {
  const map = new Map();
  const config = (module && module.componentConfig) || {};
  const selected = Array.isArray(config.licensesSelected) ? config.licensesSelected : [];
  const names = nameByKey || {};
  selected.forEach(function (entry) {
    if (!entry || typeof entry !== 'object') return;
    if (typeof entry.key !== 'string' || !entry.key) return;
    if (typeof entry.license !== 'string' || !entry.license) return;
    if (typeof entry.justification !== 'string' || !entry.justification.trim()) return;
    // hasOwnProperty, not a truthiness read: a license key is user content and
    // `constructor` / `toString` are members of every plain object.
    const name = Object.prototype.hasOwnProperty.call(names, entry.license) ?
      names[entry.license] : null;
    map.set(entry.key, {license: entry.license, name: name || entry.license});
  });
  return map;
}

/**
 * The picks that are SAFE TO INJECT: resolvedLicenseMap minus every entry whose
 * license did not resolve to a `Licenses` document or to one of the company's
 * own `privateLicenses` keys.
 *
 * The role-gated method validates the license before it stores an entry, but it
 * is not the only writer of `licensesSelected`: `updateCollection` has no role
 * check at all and the REST module POST validates against the schema, which
 * bounds the string and nothing else. Without this an arbitrary key reaches the
 * stored scan and is handed to the deployed analyzer, which evaluates it as
 * nothing at all.
 *
 * FAILS CLOSED. A caller that omits `knownLicenseKeys` gets an EMPTY map, not an
 * unfiltered one: forgetting the argument must cost an injection, never the
 * guarantee. That is also why this is a separate function rather than a flag on
 * resolvedLicenseMap, which resolvedLicenseKeys has to keep calling unfiltered
 * to build the very query the key set comes from.
 *
 * @param {Object} module a module document
 * @param {Object} [nameByKey] licenseKey -> display name, resolved by the caller
 * @param {Set} knownLicenseKeys the license keys that actually resolved
 * @returns {Map} componentKey -> {license, name}
 */
function injectableLicenseMap(module, nameByKey, knownLicenseKeys) {
  const known = knownLicenseKeys instanceof Set ? knownLicenseKeys : new Set();
  const map = resolvedLicenseMap(module, nameByKey);
  // Deleting from a Map while iterating it is well defined: an entry removed
  // before it is reached is simply not visited.
  map.forEach(function (pick, componentKey) {
    if (!known.has(pick.license)) {
      map.delete(componentKey);
    }
  });
  return map;
}

/**
 * The distinct license keys a module's resolutions name, sorted.
 *
 * The wrapper in processScan.js has to look their display names up before it can
 * build the map it injects with. Exposing this keeps the "carries a
 * justification" discriminator defined in exactly one place, and saves that
 * wrapper from building the map twice.
 *
 * @param {Object} module a module document
 * @returns {Array} distinct license keys
 */
function resolvedLicenseKeys(module) {
  const keys = new Set();
  resolvedLicenseMap(module).forEach(function (pick) { keys.add(pick.license); });
  return Array.from(keys).sort();
}

function applyToNode(node, pick) {
  const existing = Array.isArray(node.licenses) ? node.licenses : [];
  // Previously injected entries go first - by BOTH origins, because a component
  // that used to be the root of its own scan can carry a root pick. Then the
  // fresh entry is unshifted so the analyzer reads it first while the scanner's
  // declaration survives behind it.
  const kept = existing.filter(function (license) { return !isInjectedLicense(license); });
  kept.unshift(componentPickLicense(pick.license, pick.name));
  node.licenses = kept;
}

// A second view of the pick map, keyed by the lower-cased component key, holding
// ONLY the picks whose lower-cased key names exactly one of them.
//
// `createComponentFromDependency` stores `clearSpdxKey(dependency.key)` - lower
// cased - WITHOUT writing it back onto `dependency.key`, while
// `updateComponentFromDependency` does (processScan.js:427). So for a component
// that was not already in the shared catalogue, the stored scan node and the
// component document the UI resolves against can differ in case, and an
// exact-equality match applies the resolution to nothing at all: the compliance
// manager records a legal determination that quietly does nothing.
//
// UNAMBIGUOUS ONLY. The first version of this index was last-wins, which is a
// far worse bug than the one it fixed: with resolutions stored for both
// `npm:Foo` and `npm:foo`, a node keyed `npm:FOO` took whichever happened to be
// stored later. The aside, findResolutionEntry, resolutionState and
// pathResolutionKey all match EXACTLY, so the screen would show no resolution at
// all while the stored scan, the analyzer and the SBOM carried a licence picked
// for a DIFFERENT component. A silent no-op is recoverable; a silent
// mis-application inside an audit record is not.
//
// A Map again, not an object literal - a component key is scanner content. The
// original key travels with the pick because the caller has to be able to ask
// whether the tree spells it exactly somewhere else.
function lowerCaseIndex(map) {
  const byLower = new Map();
  const ambiguous = new Set();
  map.forEach(function (pick, key) {
    // map is keyed BY component key, so two entries reaching one lower-cased key
    // are always two genuinely distinct originals.
    const lower = key.toLowerCase();
    if (byLower.has(lower)) {
      ambiguous.add(lower);
      return;
    }
    byLower.set(lower, {key: key, pick: pick});
  });
  ambiguous.forEach(function (lower) { byLower.delete(lower); });
  return byLower;
}

// Every dependency node of a stored scan, once each.
//
// ONE definition of the bounds, used by both passes below. A stored scan is
// arbitrary content: the depth is capped at the same limit the ingest path
// publishes and each node object is visited once, so a cyclic or pathologically
// deep tree terminates instead of exhausting the stack. Two hand-written copies
// of that guard would be two things to keep in step.
function forEachNode(scan, visit) {
  const seen = new Set();
  (function walk(list, depth) {
    if (!Array.isArray(list) || depth > MAX_STORABLE_DEPENDENCY_DEPTH) return;
    list.forEach(function (node) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      visit(node);
      walk(node.dependencies, depth + 1);
    });
  })(scan && scan.dependencies, 1);
}

// Every `key` the stored scan spells, so the fallback can tell "the two spell
// this differently" from "these are two different packages".
function collectNodeKeys(scan) {
  const keys = new Set();
  forEachNode(scan, function (node) {
    if (typeof node.key === 'string' && node.key) {
      keys.add(node.key);
    }
  });
  return keys;
}

/**
 * Write every resolved license into the scan's dependency tree, in place.
 *
 * The node identified by `rootKey` is SKIPPED: applyRootLicense owns the root
 * from the same storage slot and runs immediately after this, producing the same
 * license marked ts-root-pick. Two writers on one node would fight.
 *
 * THE ROOT'S KEY IS SPOKEN FOR, not merely the root's node. The skip is an exact
 * comparison, and the case fallback below additionally refuses any pick stored
 * under `rootKey`, so the root's licence can reach no node at all through this
 * walk - not the root, and not a node whose key differs from it only in case.
 * That keeps "exactly one writer owns a resolved root component" an
 * unconditional statement rather than one that happens to hold for the trees we
 * looked at. A node with a resolution of ITS OWN is still resolved normally,
 * whatever its spelling: it is a different package.
 *
 * MATCHING, in order:
 *   1. exact key - always;
 *   2. lower-cased key - only when that lower-cased key names exactly one
 *      resolution AND the tree does not spell that resolution's own key
 *      anywhere. The fallback exists solely because clearSpdxKey lower-cased one
 *      side of a comparison, and that reason is gone the moment the tree carries
 *      the stored key verbatim: `github.com/Sirupsen/logrus` and
 *      `github.com/sirupsen/logrus` genuinely co-occur in Go trees and are
 *      different packages.
 *
 * The walk is bounded by the same depth the ingest path already publishes and
 * remembers the nodes it visited, so a cyclic or pathologically deep stored scan
 * terminates instead of exhausting the stack.
 *
 * @param {Object} scan the scan document (mutated in place)
 * @param {Map} map componentKey -> {license, name}, from resolvedLicenseMap
 * @param {String} [rootKey] the key of the scan's root dependency, if it has one
 * @returns {Object} {nodes, keys} - how many dependency nodes were written and
 *   which component keys were actually applied, sorted
 */
function injectResolvedLicenses(scan, map, rootKey) {
  const applied = new Set();
  let nodes = 0;
  if (!map || !map.size) {
    return {nodes: 0, keys: []};
  }
  const byLower = lowerCaseIndex(map);
  const spokenFor = collectNodeKeys(scan);
  if (typeof rootKey === 'string' && rootKey) {
    spokenFor.add(rootKey);
  }

  function pickFor(key) {
    if (map.has(key)) {
      return map.get(key);
    }
    const loose = byLower.get(key.toLowerCase());
    // A resolution the tree names exactly somewhere else belongs to THAT node.
    return loose && !spokenFor.has(loose.key) ? loose.pick : null;
  }

  forEachNode(scan, function (node) {
    const key = node.key;
    if (typeof key !== 'string' || !key || key === rootKey) return;
    const pick = pickFor(key);
    if (pick) {
      applyToNode(node, pick);
      applied.add(key);
      nodes += 1;
    }
  });
  return {nodes: nodes, keys: Array.from(applied).sort()};
}

module.exports = {
  resolvedLicenseMap,
  injectableLicenseMap,
  resolvedLicenseKeys,
  injectResolvedLicenses
};

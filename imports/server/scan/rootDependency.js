// Which entry of a scan's dependency tree is the module's own root component, and
// how the root-component license this app injects into that entry is kept out of
// the globally shared `components` catalogue.
//
// Meteor-free CommonJS on purpose, same as vulnerabilityLakeCweHelpers.js: the
// decisions are pure, they gate whether a user's root-component license pick is
// ever applied - and whether a per-company license key can leak onto a shared
// document - and processScan.js cannot be required under Jest.

/**
 * Resolve the root component of a scan, or null when the scan has no single
 * identifiable root.
 *
 * A scan's `dependencies` array is the top level of the tree, so a single entry
 * there IS the root - including when the scan recorded no children for it. An
 * application with no dependencies of its own still has a root component, and
 * the module-side UI already treats it as one (it offers the root-license
 * picker on `analysis.rootComponentsCount === 1`, which does not look at
 * children at all).
 *
 * With several top-level entries the tree is ambiguous, so only entries that
 * have children are considered, then the one matching the module identifier.
 * A flat list of several childless entries has no root and returns null rather
 * than picking one arbitrarily - overwriting an ordinary component's licenses
 * would be worse than doing nothing.
 *
 * @param {Object} scan a scan document
 * @returns {Object|null} the root dependency, or null
 */
function findRootDependency(scan) {
  const dependencies = (scan && scan.dependencies) || [];
  if (!dependencies.length) return null;
  if (dependencies.length === 1) return dependencies[0];

  const candidates = dependencies.filter(function (dep) {
    return dep && dep.dependencies && dep.dependencies.length > 0;
  });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const moduleKey = scan.moduleIdentifier || scan.module;
  const byKey = moduleKey && candidates.find(function (dep) { return dep.key === moduleKey; });
  if (byKey) return byKey;
  console.warn('=> processScan.applyRootLicense: multiple root candidates in scan', scan._id, '- using first');
  return candidates[0];
}

// Marker stamped on the license entry applyRootLicense injects into a scan's root
// dependency, so that entry can be told apart from a license the scanner actually
// declared.
//
// It has to be told apart because the injection is persisted: processScan writes
// the whole mutated scan back, and ts-analysis reads the root's licenses out of
// the scan payload, so the entry cannot simply be left out. On the NEXT run over
// that scan - `reprocessScan` is a live method behind the "Re-process" button -
// the handleDependency loop reads the persisted entry back as an ordinary declared
// license and updateComponentFromDependency writes it onto the `components`
// document. `components` is a GLOBAL catalogue shared by every tenant, and the
// injected key is usually one of the company's PRIVATE license keys (matchLicense
// resolves a private key by exact match), so each re-process disclosed one
// company's private licence key on a document every other company reads.
//
// The extra field is inert for the analyzer: ts-analysis carries these objects
// through untouched and reads `license.key || license.name` (Utils.rebuildModuleObject).
const ROOT_LICENSE_ORIGIN = 'ts-root-pick';

// The sibling marker: a license a compliance manager set manually
// on an ARBITRARY dependency, injected by componentLicensePick.js.
//
// A SEPARATE value, not a reuse of the root one, because the two injections obey
// different rules - the root's list is replaced wholesale by applyRootLicense,
// ours is unshifted in front of what the scanner declared - and telling them
// apart inside a stored scan is what makes each one's own cleanup exact.
//
// The PREDICATE below is shared, and that is the load-bearing part:
// withoutRootPickLicenses already runs for every dependency on both component
// write paths (processScan.js:373 and :459) and mapLicenseFromScanLicense
// refuses marked entries (:529). Widening the predicate is therefore the whole
// of the "a manual pick never leaks onto the shared `components` catalogue"
// requirement, with no change to the component write path at all.
const COMPONENT_LICENSE_ORIGIN = 'ts-component-pick';

const INJECTED_LICENSE_ORIGINS = [ROOT_LICENSE_ORIGIN, COMPONENT_LICENSE_ORIGIN];

/**
 * The license entry applyRootLicense injects into a scan's root dependency.
 *
 * @param {String} key resolved license key (often a company-private one)
 * @param {String} [name] display name, defaults to the key
 * @returns {Object} a marked license entry
 */
function rootPickLicense(key, name) {
  return {key: key, name: name || key, origin: ROOT_LICENSE_ORIGIN};
}

/**
 * The license entry injectResolvedLicenses puts on a resolved dependency.
 *
 * @param {String} key the license key a compliance manager picked
 * @param {String} [name] display name, defaults to the key
 * @returns {Object} a marked license entry
 */
function componentPickLicense(key, name) {
  return {key: key, name: name || key, origin: COMPONENT_LICENSE_ORIGIN};
}

/**
 * @param {Object} license a license entry from a scan dependency
 * @returns {Boolean} true when this app injected it, rather than the scanner
 */
function isInjectedLicense(license) {
  return !!(license && INJECTED_LICENSE_ORIGINS.indexOf(license.origin) !== -1);
}

// The shipped name, kept because processScan.js and the source-assertion specs
// call it - and kept as the SAME function rather than a second narrower copy,
// which is what would let a component pick through to the shared catalogue.
const isRootPickLicense = isInjectedLicense;

/**
 * The licenses of a scan dependency that may be written onto a `components`
 * document - i.e. everything except this app's own injected root pick.
 *
 * Returns the very same array when there is nothing to strip, so the ordinary
 * (overwhelmingly common) case keeps the caller's existing mutate-in-place
 * semantics untouched, and non-arrays are handed back as-is so callers can keep
 * their own `instanceof Array` guards.
 *
 * @param {Array} licenses `dependency.licenses`
 * @returns {Array} licenses safe to persist on the shared catalogue
 */
function withoutInjectedLicenses(licenses) {
  if (!Array.isArray(licenses)) return licenses;
  const kept = licenses.filter(function (license) { return !isInjectedLicense(license); });
  return kept.length === licenses.length ? licenses : kept;
}

// Same story as isRootPickLicense: the shipped name is an alias, never a copy.
const withoutRootPickLicenses = withoutInjectedLicenses;

/**
 * The license keys this app itself could ever have written into a given scan root.
 *
 * applyRootLicense (processScan.js) resolves exactly two values and no others: the
 * module's own saved pick for that root key
 * (`componentConfig.licensesSelected[].license`), and the company's
 * `defaultRootComponentLicense`. Anything else on a root, marker or no marker, was
 * put there by the scanner.
 *
 * @param {Object} root the scan's root dependency
 * @param {Object} company the company document the scan belongs to
 * @param {Object} module the module document the scan belongs to
 * @returns {Set} the keys applyRootLicense could have injected for this root
 */
function injectableRootLicenseKeys(root, company, module) {
  // A Set, not an object literal: an inherited member name ('constructor',
  // '__proto__') as a license key must not read as one of ours.
  const keys = new Set();
  const rootKey = root && root.key;
  const config = (module && module.componentConfig) || {};
  const selected = Array.isArray(config.licensesSelected) ? config.licensesSelected : [];
  if (typeof rootKey === 'string' && rootKey) {
    selected.forEach(function (entry) {
      // Same shape applyRootLicense requires before it injects: the entry has to be
      // for THIS root key and has to carry a license.
      if (entry && entry.key === rootKey && typeof entry.license === 'string' && entry.license) {
        keys.add(entry.license);
      }
    });
  }
  const fallback = company && company.defaultRootComponentLicense;
  if (typeof fallback === 'string' && fallback) keys.add(fallback);
  return keys;
}

/**
 * Drop from a scan root's persisted licenses everything a previous run of
 * applyRootLicense put there, so re-processing an ALREADY STORED scan cannot feed
 * the pick back into the shared catalogue either.
 *
 * Two shapes are dropped:
 *  - entries carrying the marker (everything written from this change on) - exact,
 *    unconditional, and independent of company and module; and
 *  - entries written before the marker existed, which have to be recognised by
 *    their key alone. That needs BOTH halves to line up: the key is one of the
 *    company's private licenses (so removing it protects the shared catalogue), AND
 *    it is a key applyRootLicense could actually have injected here
 *    (injectableRootLicenseKeys).
 *
 * The second condition is what stops this from destroying real data. A company may
 * key a private license anything at all - `privateLicenses.create` never checks the
 * key against the SPDX catalogue - so "the key is private" alone also matches a
 * scanner-declared `MIT` or `Apache-2.0`, and since findRootDependency now accepts a
 * lone childless top-level entry, that root can be an ordinary third-party package
 * out of a single-component CycloneDX/SPDX import. Dropping such an entry is
 * irrecoverable: the strip runs before the handleDependency loop, processScan
 * persists the whole mutated scan, and applyRootLicense returns early (no root key,
 * no pick, no resolvable default) without putting anything back - so the declaration
 * is gone from the stored scan, from the component write and from what ts-analysis
 * reads until the scan is re-uploaded.
 *
 * The narrowing leaves two pre-marker entries in place on purpose: one whose pick
 * was since changed or cleared, and one keyed by a non-private license. Neither can
 * be told from a declaration any more, and neither discloses a private key - the
 * second by definition, the first because applyRootLicense replaces `root.licenses`
 * wholesale right after the loop whenever a pick still resolves.
 *
 * @param {Object} root the scan's root dependency (mutated in place)
 * @param {Object} company the company document the scan belongs to
 * @param {Object} module the module document the scan belongs to
 * @returns {Boolean} whether anything was removed
 */
function stripInjectedRootLicenses(root, company, module) {
  if (!root || !Array.isArray(root.licenses) || !root.licenses.length) return false;
  const rawPrivate = company && company.privateLicenses;
  const privateKeys = new Set();
  (Array.isArray(rawPrivate) ? rawPrivate : []).forEach(function (license) {
    if (license && typeof license.key === 'string') privateKeys.add(license.key);
  });
  const ourKeys = injectableRootLicenseKeys(root, company, module);
  const kept = root.licenses.filter(function (license) {
    if (isRootPickLicense(license)) return false;
    if (!license || typeof license.key !== 'string') return true;
    return !(privateKeys.has(license.key) && ourKeys.has(license.key));
  });
  if (kept.length === root.licenses.length) return false;
  root.licenses = kept;
  return true;
}

module.exports = {
  findRootDependency,
  ROOT_LICENSE_ORIGIN,
  COMPONENT_LICENSE_ORIGIN,
  rootPickLicense,
  componentPickLicense,
  isRootPickLicense,
  isInjectedLicense,
  withoutRootPickLicenses,
  withoutInjectedLicenses,
  injectableRootLicenseKeys,
  stripInjectedRootLicenses
};

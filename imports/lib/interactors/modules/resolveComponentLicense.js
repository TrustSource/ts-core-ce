import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';
import Companies from '/imports/lib/collections/companies';
import Licenses from '/imports/lib/collections/licenses';
import {validateResolutionInput, buildResolutionEntry, isResolutionUnchanged,
  findSelectedEntry, selectedEntryCount, LICENSES_SELECTED_MAX}
  from '/imports/lib/licenseResolution/resolutionEntry';
import {safeRiskNameSegment} from '/imports/lib/licenseResolution/licenseRiskPlan';
import reconcileLicenseRisk from '/imports/lib/interactors/riskProperties/reconcileLicenseRisk';

// Record the license a compliance manager determined for a component the scan
// could not match, together with the written justification for it.
//
// The pick is stored on the MODULE, not on the shared `components` catalogue and
// not on the analysis: it survives re-analysis, it is per (module, component
// key) so it covers every occurrence and every version of that component in the
// module, and processScan/PropagateLicensePicks inject it into the stored scan
// so the deployed analyzer applies it.
//
// The signature is deliberately (moduleId, componentKey, license, justification)
// and nothing else. companyId and the acting user are re-derived from the
// session; there is nothing a browser could name that it does not already own.
//
// SERVER-ONLY BY CONTRACT. Never import from imports/client/**.

const AD = 'Access Denied';
const INVALID = 'Invalid arguments';
// A fixed literal like the other two, and the only reason to add one: the caller
// has to be able to tell "your request was malformed" from "this module cannot
// hold another resolution". It echoes nothing the caller sent.
const TOO_MANY = 'Too many license resolutions';

// Both roles. The template gate for the existing root-component picker admits
// exactly these two; `add_legal_rule_resolved` checks only 'manager' while its
// own template admits both, so a compliance manager silently hits "not allowed".
// That bug is not copied here.
const RESOLVE_ROLES = ['compliance_manager', 'manager'];

// "This entry is one of ours", as a Mongo selector - the exact condition
// resolutionEntry.hasJustification applies in JavaScript.
//
// NOT `{$exists: true}`. That also matches `null` and `''`, neither of which any
// JS discriminator in this feature accepts, so an entry carrying one - plantable
// through updateCollection, which filters nothing - would be claimed and
// OVERWRITTEN by the positional $set below and DELETED by undo's $pull, while
// the panel, the injection and findResolution all agree it is not ours.
// clearComponentLicenseResolution declares the same constant for the same
// reason; the two must never diverge.
//
// One hair-width difference survives and is inert: PCRE's `\S` counts a few code
// points JavaScript's trim() strips (a lone U+FEFF, say), so a justification
// made only of those would satisfy the selector and not hasJustification. It
// cannot decide anything - findSelectedEntry has already answered in JavaScript
// before either branch below runs, and nothing this method writes can create
// such an entry.
const OURS = {$type: 'string', $regex: /\S/};

// A license key the caller may pick: one the shared catalogue carries, or one of
// their OWN company's private licenses. Nothing else - an unknown key would be
// injected into the scan, reach the analyzer and evaluate as nothing at all.
async function licenseExists(license, companyId) {
  const known = await Licenses.findOneAsync({key: license}, {fields: {_id: 1}});
  if (known) {
    return true;
  }
  const company = await Companies.findOneAsync(companyId, {fields: {privateLicenses: 1}});
  const privateLicenses = (company && company.privateLicenses) || [];
  return privateLicenses.some(function (entry) {
    return entry && entry.key === license;
  });
}

const resolveComponentLicense = async function (moduleId, componentKey, license, justification) {
  // Step 0 - bounds BEFORE the session lookup and before any query. Schema
  // validation runs at write time, which is far too late to keep a
  // caller-supplied string out of a Mongo selector.
  const check = validateResolutionInput({moduleId, componentKey, license, justification});
  if (!check.ok) {
    throw new Meteor.Error(400, check.reason);
  }

  // Step 1 - the gate chain, in order, each a 403 with nothing written anywhere.
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!user || typeof companyId !== 'string' || !companyId) {
    throw new Meteor.Error(403, AD);
  }
  if (!await Roles.userIsInRole(user, RESOLVE_ROLES, companyId)) {
    throw new Meteor.Error(403, AD);
  }
  const module = await Modules.findOneAsync({_id: moduleId, companyId},
    {fields: {companyId: 1, projectId: 1, name: 1, 'componentConfig.licensesSelected': 1}});
  if (!module) {
    throw new Meteor.Error(403, AD);
  }

  // Step 2 - the license has to exist. Deliberately AFTER the gates: an
  // unauthenticated or foreign caller must not be able to probe the catalogue,
  // and this is the first step that needs the caller's own company.
  if (!await licenseExists(license, companyId)) {
    throw new Meteor.Error(400, INVALID);
  }

  const entry = buildResolutionEntry({componentKey, license, justification, user});
  const existing = findSelectedEntry(module, componentKey);
  if (isResolutionUnchanged(existing, entry)) {
    // No write to modules, scans, riskproperties or logevents. This is what
    // makes a DDP reconnect retry and a double-click free.
    return {ok: true, changed: false, risk: 'unchanged'};
  }

  // Step 2b - the array is not allowed to grow without bound. Each of these
  // entries carries up to 2000 characters of free text plus the author fields,
  // so an unbounded array reaches the 16MB BSON limit and makes the module
  // document unwritable by ANYTHING - including the undo that would shrink it.
  // Only an append is refused: a module already at the cap must still be able to
  // correct a resolution it carries.
  const entryCount = selectedEntryCount(module);
  if (!existing && entryCount >= LICENSES_SELECTED_MAX) {
    throw new Meteor.Error(400, TOO_MANY);
  }

  // Step 3 - the write, atomic in every branch. The array is NEVER read, edited
  // and written back: selector and modifier evaluate together against the single
  // module document, so a retry lands on the $set branch and two concurrent
  // calls converge on ONE entry instead of two.
  //
  // OURS FIRST. The positional `$` resolves to the first element the SELECTOR
  // matched, and `licensesSelected` has no uniqueness constraint on `key`: with a
  // multi-license pick stored ahead of our entry for the same component, a plain
  // `key` selector rewrites the FOREIGN entry - destroying that pick and leaving
  // two resolution entries for one key, which the three discriminators then
  // answer differently. $elemMatch names the entry this feature owns.
  let updated = await Modules.updateAsync(
    {_id: moduleId, companyId, 'componentConfig.licensesSelected':
      {$elemMatch: {key: componentKey, justification: OURS}}},
    {$set: {'componentConfig.licensesSelected.$': entry}});
  if (!updated) {
    // No entry of ours. Adopt a foreign entry for the same key if there is one -
    // resolving a component whose license was picked another way gives that pick
    // the audit trail it never had.
    updated = await Modules.updateAsync(
      {_id: moduleId, companyId, 'componentConfig.licensesSelected.key': componentKey},
      {$set: {'componentConfig.licensesSelected.$': entry}});
  }
  if (!updated) {
    const pushed = await Modules.updateAsync(
      {_id: moduleId, companyId, 'componentConfig.licensesSelected.key': {$ne: componentKey}},
      {$push: {'componentConfig.licensesSelected': entry}});
    if (!pushed) {
      // A concurrent call won the race and created the entry between the two
      // statements above. Without this the loser would answer `changed: true`
      // having written nothing at all. Bounded at one retry on purpose: by now
      // an entry for this key demonstrably exists, so the positional $set
      // matches, and a loop would be a way to spin on a document another writer
      // keeps removing.
      await Modules.updateAsync(
        {_id: moduleId, companyId, 'componentConfig.licensesSelected.key': componentKey},
        {$set: {'componentConfig.licensesSelected.$': entry}});
    }
  }
  await Modules.updateAsync({_id: moduleId, companyId}, {$set: {analysisRequired: true}});

  // Exactly one audit entry per resolution. The written reason is NOT quoted -
  // it is free text of up to 2000 characters and Company Logs is exported to CSV
  // with `quotes: false`; the record itself lives on the module document. The
  // two identifiers that are quoted go through the same filter the risk name
  // uses, for the same reason.
  await Meteor.callAsync('logEvent', user,
    'License "' + safeRiskNameSegment(license) + '" set manually for component "' +
    safeRiskNameSegment(componentKey) + '" in module ' + safeRiskNameSegment(module.name),
    'componentLicenseResolved');

  // The register is the optional extra: reconcileLicenseRisk never throws, so a
  // failure or a missing feature costs the caller a 'skipped', not the
  // resolution that is already stored.
  const risk = await reconcileLicenseRisk({module, companyId, actor: user,
    componentKey, license});
  return {ok: true, changed: true, risk};
};

export default resolveComponentLicense;

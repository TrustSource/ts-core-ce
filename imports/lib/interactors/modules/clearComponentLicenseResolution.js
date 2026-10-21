import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Modules from '/imports/lib/collections/modules';
import {validateComponentTarget, findResolution}
  from '/imports/lib/licenseResolution/resolutionEntry';
import {safeRiskNameSegment} from '/imports/lib/licenseResolution/licenseRiskPlan';

// Undo a manual license resolution.
//
// Removes the licensesSelected entry for a component ONLY when it carries a
// `justification` - the discriminator that says this feature wrote it. The same
// array also holds multi-license-modal picks and root-component-picker picks,
// and neither may be deleted by an undo of something else. The condition lives
// in the SELECTOR as well as in the pre-read, so the write stays atomic.
//
// The register is deliberately untouched: a Risk records that a license was once
// unmatched and had to be determined by hand, which stays true after the pick is
// withdrawn. Closing it is a human decision, made in the risk view.
//
// SERVER-ONLY BY CONTRACT. Never import from imports/client/**.

const AD = 'Access Denied';

// The same two roles the resolve path accepts.
const RESOLVE_ROLES = ['compliance_manager', 'manager'];

// "This entry is one of ours", as a Mongo selector - the exact condition
// resolutionEntry.hasJustification applies in JavaScript, and character for
// character the one resolveComponentLicense uses for its positional $set. NOT
// `{$exists: true}`: that also matches `null` and `''`, so a foreign entry
// carrying either - plantable through updateCollection, which filters nothing -
// would be PULLED by an undo of something the feature never wrote.
//
// The same inert hair-width difference noted there: PCRE's `\S` counts a few
// code points trim() strips, and it cannot decide anything here either, because
// findResolution has already refused in JavaScript before the $pull is issued.
const OURS = {$type: 'string', $regex: /\S/};

const clearComponentLicenseResolution = async function (moduleId, componentKey) {
  const check = validateComponentTarget({moduleId, componentKey});
  if (!check.ok) {
    throw new Meteor.Error(400, check.reason);
  }

  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!user || typeof companyId !== 'string' || !companyId) {
    throw new Meteor.Error(403, AD);
  }
  if (!await Roles.userIsInRole(user, RESOLVE_ROLES, companyId)) {
    throw new Meteor.Error(403, AD);
  }
  const module = await Modules.findOneAsync({_id: moduleId, companyId},
    {fields: {name: 1, 'componentConfig.licensesSelected': 1}});
  if (!module) {
    throw new Meteor.Error(403, AD);
  }

  if (!findResolution(module, componentKey)) {
    // Nothing of ours to withdraw. A retried undo, or an undo of a pick some
    // other writer owns, is a no-op rather than an error - and writes no
    // logevent, so the audit trail records withdrawals, not clicks.
    return {ok: true, changed: false};
  }

  const removed = await Modules.updateAsync({_id: moduleId, companyId},
    {$pull: {'componentConfig.licensesSelected': {key: componentKey,
      justification: OURS}}});
  if (!removed) {
    return {ok: true, changed: false};
  }
  // The scan still carries the injected entry until the next analysis, so the
  // module has to be re-analysed for the withdrawal to take effect.
  await Modules.updateAsync({_id: moduleId, companyId}, {$set: {analysisRequired: true}});
  await Meteor.callAsync('logEvent', user,
    'Manual license setting withdrawn for component "' + safeRiskNameSegment(componentKey) +
    '" in module ' + safeRiskNameSegment(module.name),
    'componentLicenseResolutionCleared');
  return {ok: true, changed: true};
};

export default clearComponentLicenseResolution;

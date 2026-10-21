import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import {userDisplayName} from '/imports/lib/user/displayName';
import {buildLicenseRiskAutoKey, buildLicenseRiskName, LICENSE_RISK_ORIGIN}
  from '/imports/lib/licenseResolution/licenseRiskPlan';
import {UNTOUCHED_RISK_STATES} from './managedFields';

// File a Risk for a component whose license a compliance manager set manually,
// and keep it in step on every later change to that pick.
//
// Same shape as reconcileFromSarif.js, for the same reasons: identity lives in
// `riskProperties.autoKey` (never in the name or the origin, both of which a
// human may edit), the existing `{companyId, riskProperties.autoKey}` unique
// PARTIAL index turns a retried or concurrent call into one row rather than two,
// and a state a human has already dealt with is never written to.
//
// Called ONLY by resolveComponentLicense, which has already run the whole
// authorization chain and re-read the module inside the caller's company. Every
// input here is therefore server-resolved; nothing a browser sends reaches it
// except the two identifiers it already owns.
//
// SERVER-ONLY BY CONTRACT. Never import from imports/client/**.

const PROJECTION = {fields: {
  _id: 1,
  name: 1,
  'riskProperties.state': 1,
  'riskProperties.autoLicense': 1
}};

// The same three-line predicate cweMappings/set.js and reconcileFromSarif.js use.
function isDuplicateKey(error) {
  return !!error && (error.code === 11000 || /E11000/.test(error.message || ''));
}

async function insertRisk(context) {
  await RiskProperties.insertAsync({
    created: new Date(),
    userId: context.actor._id,
    userName: userDisplayName(context.actor),
    companyId: context.companyId,
    projectId: context.projectId,
    moduleId: context.moduleId,
    name: context.name,
    riskProperties: {
      state: 'identified',
      origin: [LICENSE_RISK_ORIGIN],
      autoKey: context.autoKey,
      autoLicense: context.license
    }
  });
  await Meteor.callAsync('logEvent', context.actor,
    'Risk ' + context.name + ' created', 'licenseRiskCreated');
}

// The UPDATE branch. `state`, `origin`, `userId` and `userName` are NEVER
// rewritten: that is what keeps a human's decision and attribution intact when
// the same component is resolved again with a different license.
async function applyUpdate(existing, context) {
  const props = existing.riskProperties || {};
  if (UNTOUCHED_RISK_STATES.indexOf(props.state) !== -1) {
    // Dealt with by a human - not written to AT ALL, and note the identity
    // lookup happened anyway, so no second risk is created for this key either.
    return 'skipped';
  }
  const stored = props.autoLicense;
  if (stored === context.license) {
    // The sharp form of idempotency: no updateAsync, so no `edited`, and no
    // logEvent. This is the branch an identical resubmit that DID reach the risk
    // (because the module entry was rewritten by something else) lands on.
    return 'unchanged';
  }
  const modifier = {$set: {
    'riskProperties.autoLicense': context.license,
    edited: new Date()
  }};
  // The name is rewritten ONLY while it still reads exactly as the one this code
  // would have written for the license it had stored - i.e. we authored it and
  // nobody has renamed it since. A human's title survives a license change.
  if (typeof stored === 'string' && existing.name === buildLicenseRiskName(
    context.componentKey, stored)) {
    modifier.$set.name = context.name;
  }
  await RiskProperties.updateAsync({_id: existing._id, companyId: context.companyId}, modifier);
  await Meteor.callAsync('logEvent', context.actor,
    'Risk ' + context.name + ' updated', 'licenseRiskUpdated');
  return 'updated';
}

/**
 * Create, refresh or deliberately skip the Risk for one manual license
 * resolution.
 *
 * NEVER throws. A risk-register failure must not fail or roll back the license
 * resolution itself, which has already been written by the time this runs - so
 * every failure path answers 'skipped' and logs server-side, without echoing the
 * user's justification or any other supplied text.
 *
 * @param {Object} options {module, companyId, actor, componentKey, license}
 * @returns {Promise<String>} 'created' | 'updated' | 'unchanged' | 'skipped'
 */
const reconcileLicenseRisk = async function (options) {
  const params = options || {};
  const module = params.module;
  const companyId = params.companyId;
  const actor = params.actor;
  const componentKey = params.componentKey;
  const license = params.license;
  try {
    // Gate order, exactly as for SARIF-derived risks. The module was already
    // re-read inside the caller's company by resolveComponentLicense; asserting
    // it again here costs nothing and keeps this function safe to call from
    // anywhere.
    if (!module || module.companyId !== companyId || !actor) {
      return 'skipped';
    }
    if (!module.projectId) {
      return 'skipped';
    }
    const autoKey = buildLicenseRiskAutoKey(module._id, componentKey);
    if (!autoKey) {
      // A component key long enough to overflow the stored key. Refusing here is
      // the honest outcome: a risk whose key does not fit could not be
      // reconciled on the next resolution either.
      console.error('reconcileLicenseRisk: no storable autoKey for module ' + module._id);
      return 'skipped';
    }
    const context = {
      companyId,
      actor,
      moduleId: module._id,
      projectId: module.projectId,
      componentKey,
      license,
      autoKey,
      name: buildLicenseRiskName(componentKey, license)
    };
    const selector = {companyId, 'riskProperties.autoKey': autoKey};
    let existing = await RiskProperties.findOneAsync(selector, PROJECTION);
    if (!existing) {
      try {
        await insertRisk(context);
        return 'created';
      } catch (error) {
        // Meteor re-sends an outstanding method call on reconnect
        // and two managers can resolve the same component at once. The unique
        // partial index turns the loser into a duplicate-key error rather than a
        // duplicate row; treat it as the update it really is.
        if (!isDuplicateKey(error)) {
          throw error;
        }
        existing = await RiskProperties.findOneAsync(selector, PROJECTION);
        if (!existing) {
          return 'skipped';
        }
        // ...and fall through to the update branch WITHOUT logging a create.
      }
    }
    return await applyUpdate(existing, context);
  } catch (error) {
    // AC25. The resolution is already stored; the register is the optional
    // extra. The reason is logged and never returned - it can quote a component
    // key or a license name out of a scan.
    console.error('reconcileLicenseRisk: could not reconcile the risk for module ' +
      ((module && module._id) || 'unknown') + ' -', (error && error.message) || error);
    return 'skipped';
  }
};

export default reconcileLicenseRisk;

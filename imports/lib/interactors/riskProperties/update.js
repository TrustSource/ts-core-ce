import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';
import {stripManagedRiskFields, touchesRiskPropertiesWholesale} from './managedFields';

const update = async function (modifier, _id, filter, apiUser) {
  let user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  modifier = sanitizeModifier(modifier);
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  // The seven riskProperties fields the SARIF importer owns are
  // server-managed. `denyUpdate` is a no-op in the vendored simple-schema, so
  // this is the enforcement. The stored subdocument is read ONLY for a wholesale
  // `$set: {riskProperties: {...}}` - which REPLACES it, so the managed keys
  // have to be carried over rather than dropped, or the risk would lose the
  // identity that stops the next import creating a duplicate.
  let storedRiskProperties = null;
  if (touchesRiskPropertiesWholesale(modifier)) {
    const stored = await RiskProperties.findOneAsync(query, {fields: {riskProperties: 1}});
    storedRiskProperties = (stored && stored.riskProperties) || null;
  }
  modifier = stripManagedRiskFields(modifier, storedRiskProperties);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = ((user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  const updated = await RiskProperties.updateAsync(query, modifier);
  if (updated) {
    await logRiskUpdate(user, query, modifier);
  }
  return updated;
};

// The fields an edit changed, without the bookkeeping fields set above.
function changedFields(modifier) {
  const fields = new Set();
  Object.keys(modifier).forEach(function (operator) {
    Object.keys(modifier[operator] || {}).forEach(function (field) {
      if (['edited', 'userId', 'userName'].indexOf(field) === -1) {
        fields.add(field);
      }
    });
  });
  return Array.from(fields);
}

function touchesCountermeasures(modifier, fields) {
  return fields.some(function (field) {
    return field.indexOf('riskProperties.countermeasures') === 0 ||
      (field === 'riskProperties' && modifier.$set && modifier.$set.riskProperties &&
        Object.prototype.hasOwnProperty.call(modifier.$set.riskProperties, 'countermeasures'));
  });
}

// Every edit is written to the audit log, a countermeasure change with its own type.
async function logRiskUpdate(user, query, modifier) {
  const fields = changedFields(modifier);
  if (!fields.length) {
    return;
  }
  const risk = await RiskProperties.findOneAsync(query, {fields: {name: 1}});
  const name = (risk && risk.name) || (risk && risk._id) || '';
  const countermeasures = touchesCountermeasures(modifier, fields);
  await Meteor.callAsync('logEvent', user,
    `Risk ${name} ${countermeasures ? 'countermeasures updated' : 'updated'} (${fields.join(', ')})`,
    countermeasures ? 'riskPropertiesCountermeasuresUpdate' : 'riskPropertiesUpdate');
}

export default update;

import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Utils from '/imports/lib/utils';
import {stripManagedRiskProperties} from './managedFields';

const create = async function (params, apiUser) {
  let user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  let doc = {
    created: new Date(),
    userId: user._id,
    userName: ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
    companyId: user.profile.companyId,
    projectId: params.projectId,
    moduleId: params.moduleId,
    name: params.name,
    // A manually created risk may not plant an `autoKey` (which
    // would adopt or block an auto-managed one) or a `sourceRefs` list (evidence
    // no scan ever produced). Those fields are written only by the reconcile.
    // A payload that is not a plain object has no keys to strip - an array of
    // `{autoKey: ...}` is the shape that matters - so the stripper drops it
    // outright and an empty subdocument is stored instead of the forgery.
    riskProperties: Utils.cleanObject(stripManagedRiskProperties(params.riskProperties) || {})
  };
  let result = await RiskProperties.insertAsync(doc);
  if(result){
    await Meteor.callAsync('logEvent', user, 'Risk properties ' + doc.name + ' created', 'riskPropertiesCreate');
    return result
  }else{
    return false
  }
};

export default create;

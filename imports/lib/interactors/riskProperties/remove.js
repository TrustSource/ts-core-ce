import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';

const remove = async function (_id, filter, apiUser) {
  let user = await Meteor.userAsync();
  if (!user) {
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }
  // Always scope to the caller's company. A raw filter is only honored on the
  // trusted REST path (apiUser); a DDP client may only target one of its own
  // records by id - otherwise an empty/operator filter would mass-delete.
  const companyId = user.profile && user.profile.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let query;
  if (apiUser && filter && typeof filter === 'object') {
    query = Object.assign({}, filter, {companyId});
  } else {
    if (typeof _id !== 'string') {
      throw new Meteor.Error(400, 'Invalid id');
    }
    query = {_id, companyId};
  }
  const docId = await RiskProperties.removeAsync(query);
  if(docId){
    await Meteor.callAsync('logEvent', user, 'Risk properties removed', 'riskPropertiesRemove');
  }
  return docId
};

export default remove;

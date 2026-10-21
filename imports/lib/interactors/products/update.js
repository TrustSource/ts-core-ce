import {Meteor} from 'meteor/meteor';
import Utils from '/imports/lib/utils';
import Products from '/imports/lib/collections/products';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {resolveProductWriter} from './productAccess';

const update = async function (modifier, _id, apiUser) {
  const user = await resolveProductWriter(apiUser);
  modifier = sanitizeModifier(modifier);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].updated = new Date();
  modifier['$set'].updatedBy = user._id;
  modifier['$set'].updatedByName = Utils.username(user);
  await Meteor.callAsync('logEvent', user, _id, 'productUpdated');
  const query = {_id};
  query.companyId = user.profile.companyId
  return await Products.updateAsync(query, modifier)
};

export default update;

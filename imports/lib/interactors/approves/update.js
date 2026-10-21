import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Utils from '/imports/lib/utils';
import Approves from '/imports/lib/collections/approves';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';

const update = async function (modifier, _id, filter, apiUser) {
  let user = await Meteor.userAsync();
  if(!user){
    if (!apiUser) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    user = apiUser
  }else{
    if (!await Roles.userIsInRole(user._id, ['compliance_manager', 'manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }
  modifier = sanitizeModifier(modifier);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = Utils.username(user);
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  return await Approves.updateAsync(query, modifier)
};

export default update;

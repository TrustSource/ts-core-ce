import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Scans from '/imports/lib/collections/scans';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';

const update = async function (modifier, _id, filter, apiUser) {
  let user = await Meteor.userAsync();
  if(!user){
    user = apiUser
  }else{
    if (!await Roles.userIsInRole(user._id, ['developer', 'compliance_manager', 'manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
  }
  modifier = sanitizeModifier(modifier);
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  return Scans.updateAsync(query, modifier);
};

export default update;

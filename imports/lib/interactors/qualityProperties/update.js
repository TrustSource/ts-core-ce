import {Meteor} from 'meteor/meteor';
import QualityProperties from '/imports/lib/collections/qualityProperties';
import {sanitizeModifier} from '/imports/lib/security/sanitizeModifier';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';

const update = async function (modifier, _id, filter) {
  const user = await Meteor.userAsync();
  if (!user) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  modifier = sanitizeModifier(modifier);
  if(!modifier['$set']){
    modifier['$set']= {};
  }
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = ((user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  const query = filter ? stripDangerousOperators(filter) : {_id};
  query.companyId = user.profile.companyId
  return await QualityProperties.updateAsync(query, modifier);
};

export default update;

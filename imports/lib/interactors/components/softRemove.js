import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import Components from '/imports/lib/collections/components';
import Utils from '/imports/lib/utils';

const softRemove = async function (componentId) {
  const user = await Meteor.userAsync();
  if (!user || !await Roles.userIsInRole(user._id, ['company_component_manager'], user.profile.companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  let modifier = {
    '$set': {
      removed: true
    }
  };
  modifier['$set'].edited = new Date();
  modifier['$set'].userId = user._id;
  modifier['$set'].userName = Utils.username();
  const query = {_id: componentId};
  return await Components.updateAsync(query, modifier);
};

export default softRemove;

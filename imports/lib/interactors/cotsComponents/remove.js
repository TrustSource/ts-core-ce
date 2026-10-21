import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import COTSComponents from '/imports/lib/collections/cotsComponents';

const remove = async function (componentId) {
  const user = await Meteor.userAsync();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId || !await Roles.userIsInRole(user, ['account_admin', 'manager', 'company_component_manager'], companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const component = await COTSComponents.findOneAsync(componentId, {fields: {companyId: 1}});
  if (!component || component.companyId !== companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  const cnt = await COTSComponents.removeAsync(componentId);
  if (cnt !== 1) {
    throw new Meteor.Error(500, 'Could not delete from db');
  }
};

export default remove;

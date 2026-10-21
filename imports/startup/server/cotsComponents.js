import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Utils from '/imports/lib/utils';
import {COTSComponentsRemove} from '/imports/lib/interactors/cotsComponents';

const ACCESS_DENIED = 'Access Denied';

Meteor.methods({
  'COTSComponents.SoftRemove': async function (componentId) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, ['company_component_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    let modifier = {
      '$set': {
        removed: true
      }
    };
    modifier['$set'].edited = new Date();
    modifier['$set'].userId = user._id;
    modifier['$set'].userName = Utils.username(user);
    const query = {_id: componentId};
    return await COTSComponents.updateAsync(query, modifier);
  },

  'COTSComponents.SoftRemoveUndo': async function (componentId) {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRole(user._id, ['company_component_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, ACCESS_DENIED);
    }
    let modifier = {
      '$set': {
        removed: false
      }
    };
    modifier['$set'].edited = new Date();
    modifier['$set'].userId = user._id;
    modifier['$set'].userName = Utils.username(user);
    const query = {_id: componentId};
    return await COTSComponents.updateAsync(query, modifier);
  },

  'COTSComponents.Remove': COTSComponentsRemove
});

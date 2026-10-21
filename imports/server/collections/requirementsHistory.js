import {Meteor} from 'meteor/meteor';
import RequirementsHistory from '/imports/lib/collections/requirementsHistory';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('requirementsHistory', async function (projectId, moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  let filter = {
    companyId: user && user.profile && user.profile.companyId
  };
  if(projectId){
    filter.projectId = projectId;
  }
  if(moduleId){
    filter.moduleId = moduleId;
  }
  if (user) {
    return RequirementsHistory.find(filter, {sort: {order: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
RequirementsHistory.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawRequirementsHistory;

Meteor.startup(function () {
  RawRequirementsHistory = Utils.makeRawCollection(RequirementsHistory);
  RawRequirementsHistory.createIndex('created');
});

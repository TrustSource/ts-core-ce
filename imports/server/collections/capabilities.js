import {Meteor} from 'meteor/meteor';
import Capabilities from '/imports/lib/collections/capabilities';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('capabilities', async function (projectId, moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  let filter = {
    companyId: companyId
  };
  if(projectId){
    filter.projectId = projectId;
  }
  if(moduleId){
    filter.moduleId = moduleId;
  }
  if (user) {
    return Capabilities.find(filter, {sort: {order: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
Capabilities.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawCapabilities;

Meteor.startup(function () {
  RawCapabilities = Utils.makeRawCollection(Capabilities);
  RawCapabilities.createIndex('created');
  RawCapabilities.createIndex('companyId');
  RawCapabilities.createIndex('projectId');
  RawCapabilities.createIndex('moduleId');
  RawCapabilities.createIndex('name');
});

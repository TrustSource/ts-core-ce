import {Meteor} from 'meteor/meteor';
import AiProperties from '/imports/lib/collections/aiProperties';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('aiProperties', async function (projectId, moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  let filter = {
    companyId
  };
  if(projectId){
    filter.projectId = projectId;
  }
  if(moduleId){
    filter.moduleId = moduleId;
  }
  if (user) {
    return AiProperties.find(filter, {sort: {created: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
AiProperties.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawAiProperties;

Meteor.startup(function () {
  RawAiProperties = Utils.makeRawCollection(AiProperties);
  RawAiProperties.createIndex('created');
  RawAiProperties.createIndex('companyId');
  RawAiProperties.createIndex('projectId');
  RawAiProperties.createIndex('moduleId');
  RawAiProperties.createIndex('name');
});

import {Meteor} from 'meteor/meteor';
import QualityProperties from '/imports/lib/collections/qualityProperties';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('qualityProperties', async function (projectId, moduleId) {
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
    return QualityProperties.find(filter, {sort: {order: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
QualityProperties.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawQualityProperties;

Meteor.startup(function () {
  RawQualityProperties = Utils.makeRawCollection(QualityProperties);
  RawQualityProperties.createIndex('created');
  RawQualityProperties.createIndex('companyId');
  RawQualityProperties.createIndex('projectId');
  RawQualityProperties.createIndex('moduleId');
  RawQualityProperties.createIndex('toolId');
  RawQualityProperties.createIndex('name');
});

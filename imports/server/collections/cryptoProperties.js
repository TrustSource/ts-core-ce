import {Meteor} from 'meteor/meteor';
import CryptoProperties from '/imports/lib/collections/cryptoProperties';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('cryptoProperties', async function (projectId, moduleId) {
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
    return CryptoProperties.find(filter, {sort: {order: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
CryptoProperties.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawCryptoProperties;

Meteor.startup(function () {
  RawCryptoProperties = Utils.makeRawCollection(CryptoProperties);
  RawCryptoProperties.createIndex('created');
  RawCryptoProperties.createIndex('companyId');
  RawCryptoProperties.createIndex('projectId');
  RawCryptoProperties.createIndex('moduleId');
  RawCryptoProperties.createIndex('name');
});

import {Meteor} from 'meteor/meteor';
import SbomFiles from '/imports/lib/collections/sbomFiles';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('SbomFiles', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    return SbomFiles.find({'companyId': user.profile.companyId})
  }
  this.ready();
});

Meteor.publish('sbomFileDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if(_id && user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return SbomFiles.find({_id, companyId});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
SbomFiles.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawSbomFiles;

Meteor.startup(function () {
  RawSbomFiles = Utils.makeRawCollection(SbomFiles);
  RawSbomFiles.createIndex('companyId');
  RawSbomFiles.createIndex('approveId');
  RawSbomFiles.createIndex('moduleId');
  RawSbomFiles.createIndex('projectId');
});

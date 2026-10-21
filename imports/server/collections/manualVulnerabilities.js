import {Meteor} from 'meteor/meteor';
import ManualVulnerabilities from '/imports/lib/collections/manualVulnerabilities';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('manualVulnerabilities', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return ManualVulnerabilities.find({companyId})
  }
  this.ready();
});

Meteor.publish('manualVulnerabilitiesDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return ManualVulnerabilities.find({_id, companyId});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
ManualVulnerabilities.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawManualVulnerabilities;

Meteor.startup(function () {
  RawManualVulnerabilities = Utils.makeRawCollection(ManualVulnerabilities);
  RawManualVulnerabilities.createIndex('companyId');
  RawManualVulnerabilities.createIndex('component.key');
});

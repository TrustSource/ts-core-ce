import {Meteor} from 'meteor/meteor';
import ComponentModifications from '/imports/lib/collections/componentModifications';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('componentModifications', async function (moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile) {
    const companyId = user.profile.companyId;
    return ComponentModifications.find({companyId, moduleId})
  }
  this.ready();
});

Meteor.publish('componentModificationDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  return ComponentModifications.find({_id: _id, companyId});
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
ComponentModifications.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawComponentModifications;

Meteor.startup(function () {
  RawComponentModifications = Utils.makeRawCollection(ComponentModifications);
  RawComponentModifications.createIndex('companyId');
  RawComponentModifications.createIndex('moduleId');
});

import {Meteor} from 'meteor/meteor';
import Tags from '/imports/lib/collections/tags';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('tags', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return Tags.find({companyId})
  }
  this.ready();
});

Meteor.publish('tagsDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    const companyId = user.profile.companyId;
    return Tags.find({_id, companyId})
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Tags.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});


Meteor.methods({
  getCompanyTags: async function () {
    const user = await Meteor.userAsync();
    if (!user) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await Tags.find({companyId: user.profile.companyId, deleted: {$exists: false}}).fetchAsync();
  },
  getTagsByCompanyId: async function (companyId) {
    const user = await Meteor.userAsync();
    if (!companyId || (user && user.profile.companyId && user.profile.companyId !== companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await Tags.find({companyId, deleted: {$exists: false}}).fetchAsync();
  }
})

/**
 * Create global raw Collection and ensure indexes
 */

export let RawTags;

Meteor.startup(function () {
  RawTags = Utils.makeRawCollection(Tags);
  RawTags.createIndex('companyId');
  RawTags.createIndex('name');
  RawTags.createIndex('deleted');
});

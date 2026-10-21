import {Meteor} from 'meteor/meteor';
import Updates from '/imports/lib/collections/updates';
import Utils from '/imports/server/ServerUtils';

// installationId is a persistent per-installation identifier kept on the
// release-note document for the server-side version check; never publish it.
const UPDATES_PUBLIC_FIELDS = {created: 0, installationId: 0};

Meteor.publish('updates', async function () {
  if (!this.userId) { return this.ready(); }
  let user = await Meteor.users.findOneAsync(this.userId);
  if(user){
    const now = new Date()
    return Updates.find({$and:[{published: {$exists: true}},{published: {$lte: now}}]},
      {sort: {published: -1}, limit: 500, fields: UPDATES_PUBLIC_FIELDS});
  }
  this.ready();
});

Meteor.publish('updatesLatest', async function () {
  if (!this.userId) { return this.ready(); }
  let user = await Meteor.users.findOneAsync(this.userId);
  if(user){
    const now = new Date()
    return Updates.find({$and:[{viewedBy: { $ne: user._id }},
      {published: {$exists: true}},{published: {$lte: now}}]}, {limit: 1, fields: UPDATES_PUBLIC_FIELDS});
  }
  this.ready();
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawUpdates;

Meteor.startup(function () {
  RawUpdates = Utils.makeRawCollection(Updates);
  RawUpdates.createIndex('created');
  RawUpdates.createIndex('published');
  RawUpdates.createIndex('viewedBy');
});

import {Meteor} from 'meteor/meteor';
import Utils from '/imports/server/ServerUtils';
import SBOMs from '/imports/lib/collections/sboms';

Meteor.publish('sbomDetail', async function (id) {
  if (typeof id !== 'string') { return this.ready(); }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  return SBOMs.find({id, companyId});
});

// Written only by server code; no client code writes this collection directly.
SBOMs.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawSBOMs;

Meteor.startup(function () {
  RawSBOMs = Utils.makeRawCollection(SBOMs);
  RawSBOMs.createIndex('companyId');
  RawSBOMs.createIndex('approveId');
  RawSBOMs.createIndex('created');
});

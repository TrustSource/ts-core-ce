import {Meteor} from 'meteor/meteor';
import Trademarks from '/imports/lib/collections/trademarks';
import Utils from '/imports/server/ServerUtils';
import {trademarkUpserts} from '/imports/server/trademarks/trademarksData';

// The Copyright & Trademarks registry is read-only in the Community Edition. It has
// no allow rule and no method, so a client cannot write it; its content is shipped
// in imports/server/trademarks/trademarksData.js and forced below on every start.

Meteor.publish('trademarks', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user) {
    return Trademarks.find()
  }
  this.ready();
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawTrademarks;

Meteor.startup(async function () {
  RawTrademarks = Utils.makeRawCollection(Trademarks);
  RawTrademarks.createIndex('name');

  for (const {selector, modifier} of trademarkUpserts()) {
    try {
      await Trademarks.upsertAsync(selector, modifier);
    } catch (e) {
      console.error('=> Trademark sync failed for', selector._id, e.message);
    }
  }
});

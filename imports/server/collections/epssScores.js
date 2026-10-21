import {Meteor} from 'meteor/meteor';
import EpssScores from '/imports/lib/collections/epssScores';
import Utils from '/imports/server/ServerUtils';

// Scores are looked up by `_id` (the CVE id), which is indexed already. The only
// index worth adding is the one that bounds the collection: a document older
// than this is far past the freshness window ts-epss.js applies, so keeping it
// only costs space. Mongo removes them on its own.
const EXPIRE_AFTER_DAYS = 30;

export let RawEpssScores;

Meteor.startup(function () {
  RawEpssScores = Utils.makeRawCollection(EpssScores);
  RawEpssScores.createIndex('fetchedAt', {expireAfterSeconds: EXPIRE_AFTER_DAYS * 24 * 60 * 60});
});

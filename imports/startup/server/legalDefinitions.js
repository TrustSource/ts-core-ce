import {Meteor} from 'meteor/meteor';
import Constraints from '/imports/lib/collections/constraints';
import Rules from '/imports/lib/collections/rules';
import LEGAL_DEFINITIONS from '/imports/server/legalcheck/legal-definitions.json';
import Utils from '/imports/lib/utils';

// Obligations and legal rules of the license check model the bundled ts_legalcheck
// service runs (legal-definitions.json, exported from that model). Its results name
// obligations and rules by these keys; without them the app can neither describe an
// obligation nor tell a warning rule from a violation. Seeded like the licenses:
// only keys still missing are inserted, so an entry edited in the database survives.
async function seedMissing(collection, entries, label) {
  const existing = (await collection.find({}, {fields: {key: 1}}).fetchAsync())
    .map(function (entry) { return entry.key; });
  let seededCount = 0;
  for (const entry of entries) {
    if (existing.indexOf(entry.key) !== -1) {
      continue;
    }
    try {
      await collection.insertAsync(Object.assign({}, entry, {created: new Date()}));
      seededCount++;
    } catch (e) {
      console.error('=> ' + label + ' seed failed for', entry.key, e.message);
    }
  }
  if (seededCount) {
    console.log('=> ' + label + ' seeded:', seededCount);
  }
}

Meteor.startup(async () => {
  await seedMissing(Constraints, LEGAL_DEFINITIONS.obligations, 'Legal obligations');
  await seedMissing(Rules, LEGAL_DEFINITIONS.rules, 'Legal rules');
  // translateObligations / translatePermitions read a cache filled at startup.
  await Utils.loadServerLegalDefinitions();
});

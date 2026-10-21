import {Meteor} from 'meteor/meteor';
import CweMappings from '/imports/lib/collections/cweMappings';
import Utils from '../ServerUtils';

// The caller's own candidates plus the global defaults.
//
// The company comes from the caller's own user document, never from an argument
// - this publication takes none, so there is nothing to spoof. `profile.companyId`
// is server-owned: the `Meteor.users` allow rule lets a client write only `roles`,
// `componentConfig`, `licenseConfig` and `intro`, and the one path that changes it,
// `changeCompany`, refuses any company the user holds no role in.
//
// `{companyId: null}` matches a document whose companyId is null AND one that
// carries no companyId at all, so a global default written either way is found.
// Readable by any authenticated member of the company: everyone sees the
// weakness badges, only the gated roles may write one.
Meteor.publish('cweMappings', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && typeof user.profile.companyId === 'string' && user.profile.companyId) {
    // Fields the overlay needs and nothing else. A global default carries the
    // name of whoever curated it, which is TrustSource-internal and must not be
    // published to every customer that inherits the default.
    return CweMappings.find({$or: [{companyId: user.profile.companyId}, {companyId: null}]},
      {fields: {tool: 1, ruleId: 1, cwes: 1, companyId: 1}});
  }
  this.ready();
});

// Writes go through CweMappings.Set / CweMappings.Remove, which resolve the
// company from the caller and check the role. Nothing client-side may touch this
// collection directly - a mapping one company enters is a candidate for becoming
// every company's default.
// Written only by server code; no client code writes this collection directly.
CweMappings.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

export let RawCweMappings;

Meteor.startup(function () {
  RawCweMappings = Utils.makeRawCollection(CweMappings);
  RawCweMappings.createIndex('companyId');
  // One mapping per rule per scope. A partial index would be tidier, but the
  // sparse-vs-missing behaviour differs between a null companyId and an absent
  // one, and this form treats both as the same global slot - which is what the
  // publication query above already assumes.
  RawCweMappings.createIndex({companyId: 1, tool: 1, ruleId: 1}, {unique: true});
});

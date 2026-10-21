import {Meteor} from 'meteor/meteor';
import RiskProperties from '/imports/lib/collections/riskProperties';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('riskProperties', async function (projectId, moduleId) {
  const user = await Meteor.users.findOneAsync(this.userId);
  let filter = {
    companyId: user && user.profile && user.profile.companyId
  };
  if(projectId){
    filter.projectId = projectId;
  }
  if(moduleId){
    filter.moduleId = moduleId;
  }
  if (user) {
    return RiskProperties.find(filter, {sort: {created: -1}})
  }
  this.ready();
});

// Written only by server code; no client code writes this collection directly.
RiskProperties.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawRiskProperties;

Meteor.startup(function () {
  RawRiskProperties = Utils.makeRawCollection(RiskProperties);
  RawRiskProperties.createIndex('created');
  RawRiskProperties.createIndex('companyId');
  RawRiskProperties.createIndex('projectId');
  RawRiskProperties.createIndex('moduleId');
  RawRiskProperties.createIndex('name');
  // The identity of a risk the SARIF importer maintains. This index
  // is what turns two concurrent imports of the same document (two CI jobs, or
  // Meteor re-sending an outstanding method call on reconnect) into one risk
  // instead of two: the loser gets a duplicate-key error, which reconcileFromSarif
  // treats as the update it really is, so neither request fails (AC18, AC21).
  //
  // COMPOUND on companyId, not unique on the key alone. autoKey is derived from
  // a moduleId, which already belongs to exactly one company, so a global unique
  // index enforces the same thing today - but it makes one tenant's row able to
  // refuse another tenant's insert. A key present in company A would give
  // company B an E11000, and the fall-through then re-reads inside B's own
  // company, finds nothing, and answers `skipped`: a permanent, silent,
  // cross-tenant denial of the whole feature for that weakness. Nothing lets a
  // client choose an autoKey today (managedFields.js strips it from every
  // client-reachable write), so this is defence in depth - and it is free while
  // the index still covers zero documents. The reconcile's lookup selector is
  // {companyId, 'riskProperties.autoKey'}, an exact match for this key pattern.
  //
  // PARTIAL rather than sparse: both skip documents without the field - which is
  // what keeps every hand-made risk out of it (AC20) - but MongoDB documents
  // partial as the general replacement for sparse, the filter is self-documenting,
  // and it can express a narrower identity later while sparse cannot. `$exists`
  // rather than `$type: 'string'` so the query planner can prove the reconcile's
  // lookup selector is a subset of the filter and actually use the index.
  //
  // Brand-new field, so the filter covers ZERO documents on first build: an
  // E11000 at build time is impossible and there is nothing to migrate. Not
  // awaited, matching the calls above - Meteor 3 binds the HTTP port only after
  // every startup hook resolves, and a blocking index build would keep
  // /healthcheck unanswered long enough for the ALB to abort a rollout. The
  // .catch is what stops a rejected build surfacing as an unhandled rejection
  // instead of a line in the task log.
  RawRiskProperties.createIndex(
    {companyId: 1, 'riskProperties.autoKey': 1},
    {unique: true,
      partialFilterExpression: {'riskProperties.autoKey': {$exists: true}},
      name: 'riskProperties_company_autoKey_unique'}
  ).catch(function (error) {
    console.error('riskProperties: autoKey unique index could not be created -',
      (error && error.message) || error);
  });
  // The globally-unique predecessor of the index above, dropped explicitly.
  //
  // createIndex only ever adds, so an environment that ran an earlier build of
  // this change keeps `riskProperties_autoKey_unique` alongside the compound index and
  // goes on enforcing uniqueness across tenants - which is the exact denial the
  // compound key exists to prevent, and it survives every subsequent deploy
  // unnoticed because the new index does get created and nothing complains.
  // Confirmed against a real server, not reasoned about: with both present,
  // company A holding a key makes company B's insert of the same key fail
  // E11000 naming `riskProperties_autoKey_unique`.
  //
  // IndexNotFound (27) is the normal answer on every environment that never ran
  // that build, and NamespaceNotFound (26) on a fresh database where the collection
  // does not exist yet, so neither is worth logging; anything else is.
  RawRiskProperties.dropIndex('riskProperties_autoKey_unique').catch(function (error) {
    if (error && (error.code === 26 || error.code === 27 ||
      /index not found|\bns not found/i.test(error.message || ''))) {
      return;
    }
    console.error('riskProperties: stale global autoKey index could not be dropped -',
      (error && error.message) || error);
  });
});

import {Meteor} from 'meteor/meteor';
import ComponentLogs from '/imports/lib/collections/componentLogs';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('componentLogs', async function (componentId) {
  // Component logs are platform-wide (global component catalog), so they are NOT
  // scoped by company. But require an authenticated caller and a scalar
  // componentId: previously this was reachable unauthenticated and a {$ne:null}
  // operator dumped every log in the collection.
  if (typeof componentId !== 'string') {
    return this.ready();
  }
  if (!this.userId) {
    return this.ready();
  }
  // Cap at the 10 newest entries - stored history is pruned to the same
  // limit on insert (ComponentLogs.Create), this also covers components
  // whose stored history has not been trimmed yet.
  return ComponentLogs.find({componentId}, {sort: {created: -1}, limit: 10});
});

// Component history is written only by server code (ComponentLogs.Create, which
// the DDP guard keeps server-only); a client insert would forge entries in the
// platform-wide history.
ComponentLogs.allow({
  insert: function () {
    return false
  },
  update: function () {
    return false
  },
  remove: function () {
    return false
  }
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawComponentLog;

Meteor.startup(function () {
  RawComponentLog = Utils.makeRawCollection(ComponentLogs);
  RawComponentLog.createIndex('componentId');
  RawComponentLog.createIndex('componentKey');
  RawComponentLog.createIndex('created');
});

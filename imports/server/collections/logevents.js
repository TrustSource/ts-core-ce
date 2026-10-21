import {Meteor} from 'meteor/meteor';
import LogEvents from '/imports/lib/collections/logevents';
import logEvent, {logEventsTypes} from '/imports/server/logEvent';
import {moment} from 'meteor/momentjs:moment';
import Utils from '/imports/server/ServerUtils';
import ServerSideCollection from '/imports/server/serverSideCollection';
import Modules from '/imports/lib/collections/modules';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';
import _ from 'underscore';

// Force a client-supplied list selector into the caller's tenant. Strips
// server-side-execution operators ($where/$expr/…), discards a non-object
// selector, and overrides any client `companyId` so a DDP caller can never
// read another company's events by passing {companyId: 'victim'} or
// {companyId: {$ne: null}}.
function scopeSelectorToCompany(rawSelector, companyId) {
  let selector = rawSelector;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    selector = {};
  }
  selector = stripDangerousOperators(selector);
  selector.companyId = companyId;
  return selector;
}

Meteor.publish('activityLogs', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    return LogEvents.find({companyId : user.profile.companyId}, {sort: {date: -1}, limit: 10});
  }
  this.ready();
});

Meteor.methods({
  logEvent: async function (user, msg, type) {
    // Audit-log writer. For real client DDP calls (this.connection set) never
    // trust the client-supplied `user` object - it controls companyId/userName/
    // account in the written record, so a forged object would let a caller
    // inject spoofed entries into ANY company's log. Derive the actor from the
    // authenticated session instead. Server-internal calls (no connection, e.g.
    // scan processing) pass a trusted server-built user and are honoured as-is.
    if (this.connection) {
      if (!this.userId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      const actor = await Meteor.users.findOneAsync(this.userId);
      if (!actor) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      return logEvent(actor, msg, type)
    }
    return logEvent(user, msg, type)
  },
  logEventsByModule: async function (moduleId, componentKey, unlimited) {
    const user = await Meteor.userAsync();
    const companyId = user.profile.companyId
    const module = await Modules.findOneAsync({_id: moduleId, companyId}, {fields: {name: 1}})
    if(module && componentKey) {
      let logsFilter = {
        companyId: companyId,
        'message': {$regex: `(?=.*${module.name})(?=.*${Utils.escapeRegex(componentKey)})`}
      }
      if(!unlimited){
        let from = moment().subtract(30 , 'day')
        const fromIso = new Date(from.toISOString());
        logsFilter.date = {$gt: fromIso}
      }
      return await LogEvents.find(logsFilter, {sort: {date: -1}, limit: 100}).fetchAsync()
    }
  }
});

if (Meteor.isServer) {
  Meteor.methods({
    'LogEvents.FindTypes': async function() {
      return {
        list: _.sortBy(logEventsTypes, 'key'),
        meta: {
          items:logEventsTypes.length,
          pages:0,
          size:1000,
          page:0
        }
      }
    },
    'LogEvents.ByCompany': async function(selector, sort, page, size, fields) {
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      selector = scopeSelectorToCompany(selector, companyId);
      return ServerSideCollection.find(LogEvents, {selector, sort, page, size, fields})
    },
    'LogEvents.ByUser': async function(selector, sort, page, size, fields) {
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      selector = scopeSelectorToCompany(selector, companyId);
      return ServerSideCollection.find(LogEvents, {selector, sort, page, size, fields})
    }
  })
}

/**
 * Create global raw Collection and ensure indexes
 */

export let RawLogEvents;

Meteor.startup(function () {
  RawLogEvents = Utils.makeRawCollection(LogEvents);
  RawLogEvents.createIndex('companyId');
  RawLogEvents.createIndex('userId');
  RawLogEvents.createIndex('date');
  RawLogEvents.createIndex('userName');
  RawLogEvents.createIndex('company');
  RawLogEvents.createIndex('type');
  // Backs companyLogs (companyId equality + sort by date desc). Without this
  // the planner picks {date:1} and walks the whole collection.
  RawLogEvents.createIndex({companyId: 1, date: -1});
  // Backs companyLogs when the user picks an event type from the Advanced
  // filter dropdown - equality on companyId + type, sorted by date desc.
  RawLogEvents.createIndex({companyId: 1, type: 1, date: -1});
});

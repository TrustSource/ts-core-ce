import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import {moment} from 'meteor/momentjs:moment';
import _ from 'underscore';
import LoginsHistory from '/imports/lib/collections/loginsHistory';
import UserExtUtils from '/imports/lib/userExtUtils';
import Utils from '/imports/server/ServerUtils';
import ServerSideCollection from '/imports/server/serverSideCollection';
import {stripDangerousOperators} from '/imports/lib/security/sanitizeQuery';

// Written only by server code; no client code writes this collection directly.
LoginsHistory.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

if (Meteor.isServer) {
  Meteor.methods({
    'LoginsHistory.ByCompany': async function(selector, sort, page, size, fields) {
      const companyId = await Utils.getCompanyIdForUserAsync(this.userId);
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      // Force the caller's company into the selector - never trust a client
      // companyId (would expose another tenant's login history).
      if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
        selector = {};
      }
      selector = stripDangerousOperators(selector);
      selector.companyId = companyId;
      return ServerSideCollection.find(LoginsHistory, {selector, sort, page, size, fields})
    },
    'LoginsHistory.NoLoginsByCompany': async function(company_id) {
      // DDP callers are pinned to their OWN company (the client company_id is
      // ignored - trusting it would enumerate another tenant's users). The
      // explicit company_id is honoured only for trusted server/REST calls
      // (no userId), where it is the apikey's authoritative company.
      const userCompanyId = await Utils.getCompanyIdForUserAsync(this.userId);
      const companyId = this.userId ? userCompanyId : company_id;
      if (!companyId) {
        throw new Meteor.Error(403, 'Access Denied');
      }
      const now = moment();
      let logins = {}
      await LoginsHistory.find({
        created: {
          $gt: now.subtract(60, 'days').toDate()
        },
        allowed: true,
        companyId: companyId
      }, {fields: {companyId: 1, userId: 1, created: 1}, sort:{created : -1}}).forEachAsync((item)=>{
        if(!logins[item.userId]){
          logins[item.userId] = item.created
        }
      })
      const userIds = _.uniq(Object.keys(logins))
      // Get all users in this company via Roles v4 API, then exclude those with logins
      const allRoles = UserExtUtils.availableRolesKeys();
      const companyCursor = await Roles.getUsersInRole(allRoles, {scope: companyId});
      const companyUsers = await companyCursor.fetchAsync();
      return companyUsers.filter(u => !userIds.includes(u._id)).map((item)=>{
        return {
          userEmail: item.profile.email,
          userName: getUserName(item),
          created: item.createdAt
        }
      });
    }
  })
}

function getUserName(user) {
  if (user) {
    if (user.profile && user.profile.name) {
      return user.profile.name;
    }
    if (user.name) {
      return user.name;
    }
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if  (user.profile.email){
      return user.profile.email
    }
  }
  return false
}

/**
 * Create global raw Collection and ensure indexes
 */

export let RawLoginsHistory;

Meteor.startup(function () {
  RawLoginsHistory = Utils.makeRawCollection(LoginsHistory);
  RawLoginsHistory.createIndex('created');
  RawLoginsHistory.createIndex('userId');
  RawLoginsHistory.createIndex('companyId');
  // Backs the loginsHistory page (companyId equality + sort by created desc).
  RawLoginsHistory.createIndex({companyId: 1, created: -1});
});

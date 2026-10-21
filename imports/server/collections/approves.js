import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Approves from '/imports/lib/collections/approves';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/server/ServerUtils';
import {asString} from '/imports/lib/security/sanitizeQuery';

const fields = {'stats.vulnerability':0, 'stats.licenses':0, 'stats.legal':0,
  'stats.versioning':0, 'stats.viability':0, 'stats.changes':0}

Meteor.publish('Approves', async function () {
  const userId = this.userId;
  const user = await Meteor.users.findOneAsync(userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (companyId && user && (await Roles.userIsInRole(user, ['compliance_manager'], companyId))) {
    return Approves.find({'companyId': companyId},{fields});
  }else if (companyId && user && (await Roles.userIsInRole(user, ['manager'], companyId))) {
    let projectIds = await Projects.find({
      $and: [{
        companyId: companyId
      },{
        $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.defaultProjectManager': userId}
        ]}
      ]
    },{fields: {name: true}}).fetchAsync();
    if(projectIds.length){
      projectIds = _.map(projectIds, function (project) {
        return project._id
      })
    }
    return Approves.find({$or:[
      {'companyId': user.profile.companyId, 'projectId': {$in : projectIds}},
      {'companyId': user.profile.companyId, 'initiator': userId, 'draft': true}
    ]},{fields});
  }
  this.ready();
});

Meteor.publish('incomingApproves', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    return Approves.find({'companyId': user.profile.companyId, $and:[{
      'approved': {$exists: false}
    },{
      'rejected': {$exists: false}
    }]},{fields})
  }
  this.ready();
});

Meteor.publish('approveDetail', async function (_id) {
  const id = asString(_id);
  if (!id) {
    return this.ready();
  }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  return Approves.find({_id: id, companyId});
});

Meteor.publish('approveNoticeFiles', async function (approveId) {
  const id = asString(approveId);
  if (!id) {
    return this.ready();
  }
  const user = await Meteor.users.findOneAsync(this.userId);
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) {
    return this.ready();
  }
  return NoticeFiles.find({approveId: id, companyId});
});

Meteor.publish('projectApprovedVersions', async function (projectId) {
  const pid = asString(projectId);
  if (!pid) {
    return this.ready();
  }
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    return Approves.find({'companyId': user.profile.companyId, 'projectId': pid, 'approved':{$exists: true}},
      {sort: {approved: -1}})
  }
  this.ready();
});

Meteor.publish('approvedReleases', async function (params) {
  const user = await Meteor.users.findOneAsync(this.userId);
  let filter = params || {} ;
  filter.companyId = user && user.profile && user.profile.companyId;
  filter.approved = {$exists: true};
  const fields = {name: 1, modules: 1, projectId: 1, version: 1, approved:1, closedByName: 1}
  if (filter.companyId) {
    return Approves.find(filter, { fields })
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Approves.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawApproves;

Meteor.startup(function () {
  RawApproves = Utils.makeRawCollection(Approves);
  RawApproves.createIndex('companyId');
});

import {Meteor} from 'meteor/meteor';
import Messages from '/imports/lib/collections/messages';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('moduleMessages', async function (projectId, moduleId) {
  if (!this.userId) { return this.ready(); }
  let user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return Messages.find({projectId, moduleId, companyId, public:true}, {sort: {created: -1}, limit: 500});
  }
  this.ready();
});

Meteor.publish('messagesByUser', async function () {
  if (!this.userId) { return this.ready(); }
  let user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return Messages.find({userId: this.userId, companyId}, {sort: {created: -1}, limit: 500});
  }
  this.ready();
});

Meteor.publish('messagesLatest', async function () {
  if (!this.userId) { return this.ready(); }
  let user = await Meteor.users.findOneAsync(this.userId);
  if(user && user.profile && user.profile.companyId){
    const companyId = user.profile.companyId;
    return Messages.find({userId: this.userId, companyId}, {sort: {created: -1}, limit: 1});
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
Messages.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawMessages;

Meteor.startup(function () {
  RawMessages = Utils.makeRawCollection(Messages);
  RawMessages.createIndex('companyId');
  RawMessages.createIndex('moduleId');
  RawMessages.createIndex('projectId');
  RawMessages.createIndex('userId');
  RawMessages.createIndex('created');
});

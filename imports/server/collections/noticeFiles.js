import {Meteor} from 'meteor/meteor';
import NoticeFiles from '/imports/lib/collections/noticeFiles';
import Utils from '/imports/server/ServerUtils';

Meteor.publish('NoticeFiles', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (user && user.profile && user.profile.companyId) {
    return NoticeFiles.find({'companyId': user.profile.companyId})
  }
  this.ready();
});

Meteor.publish('noticeFileDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  if(_id){
    const user = await Meteor.users.findOneAsync(this.userId);
    if (user && user.profile && user.profile.companyId) {
      const companyId = user.profile.companyId;
      return NoticeFiles.find({_id, companyId})
    }
    this.ready();
  }
  this.ready();
});

Meteor.publish('noticeFileFullDetail', async function (_id) {
  if (typeof _id !== 'string') { return this.ready(); }
  if(_id){
    const result = await Meteor.callAsync('NoticeFiles.FindOne', _id);
    // FindOne returns undefined for a missing or cross-tenant _id - guard before
    // dereferencing, otherwise the subscription throws and the client gets nothing.
    if (result && result._id) {
      this.added('noticeFiles', result._id, result);
    }
  }
  this.ready();
});

// Every UI write goes through a server method that checks the caller's access;
// an allow rule here would be a second, weaker write path.
NoticeFiles.deny({
  insert: () => true,
  update: () => true,
  remove: () => true
});

/**
 * Create global raw Collection and ensure indexes
 */

export let RawNoticeFiles;

Meteor.startup(function () {
  RawNoticeFiles = Utils.makeRawCollection(NoticeFiles);
  RawNoticeFiles.createIndex('companyId');
  RawNoticeFiles.createIndex('approveId');
  RawNoticeFiles.createIndex('moduleId');
  RawNoticeFiles.createIndex('projectId');
});

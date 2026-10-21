import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

Template.releaseLine.events({
  'click .add_assignment': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const settings = this;
    Meteor.callAsync(
      'Approves.Update',
      {$set: {assignment:currUser._id,assignmentName: Utils.username()}},
      settings.release._id
    ).then(function() {
      Meteor.callAsync('logEvent', currUser, 'Approval for '+settings.release.name+' has new assignment '+
        settings.release.assignmentName,
      'approveProject');
    }).catch(function(error) {
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', currUser, 'Error: '+ error.message, 'approveProject');
    });
  },
  'click .remove_assignment': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const settings = this;
    Meteor.callAsync(
      'Approves.Update',
      {$unset: {assignment:true,assignmentName: true}},
      settings.release._id
    ).then(function() {
      Meteor.callAsync('logEvent', currUser, 'Assignment removed from '+settings.release.name+' approval',
        'approveProject');
    }).catch(function(error) {
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', currUser, 'Error: '+ error.message, 'approveProject');
    });
  }
});

Template.releaseLine.helpers({
  getNoticeOptions: function () {
    return {noticeId : this.release.noticeFileId}
  },
  getApproveOptions: function () {
    return {approveId : this.release._id}
  }
});

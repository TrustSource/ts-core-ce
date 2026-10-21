import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {moment} from 'meteor/momentjs:moment';
import PolicyItem from '/imports/lib/company/Policy';
import Utils from '/imports/lib/utils';


function getLastPolicy() {
  Meteor.callAsync('getLastPolicyUpdates').then(function(result) {
    Session.set('newPolicyUpdates', result);
    if(result){
      $('#notifyPolicy').modal('show');
    }
  }).catch(function(error) {
    console.log(error);
    Session.set('newPolicyUpdates');
  });
}

function policyUpdateNotified(user,type,present) {
  const userName = user.profile.name || user.profile.email || user.emails && user.emails[0] && user.emails[0].address;
  const policy = Session.get('newPolicyUpdates');
  if (policy){
    let currentUserPolicy = {};
    if(!policy.notified){
      policy.notified = [];
    }else{
      currentUserPolicy = _.find(policy.notified,function (item) {
        return item.userId === user._id
      });
      if(currentUserPolicy && !currentUserPolicy.confirmedDate){
        policy.notified = _.reject(policy.notified,function (userItem) {
          return currentUserPolicy.userId === userItem.userId
        });
      }
    }
    if(!currentUserPolicy || (currentUserPolicy && !currentUserPolicy.userId)){
      currentUserPolicy = {
        userId: user._id,
        name: userName
      };
    }
    currentUserPolicy[type+'edDate'] = new Date();
    if(type === 'confirm' && !currentUserPolicy['presentedDate']){
      currentUserPolicy['presentedDate'] = new Date()
    }
    policy.notified.push(currentUserPolicy);
    return Meteor.callAsync('Policy.UpdateNotified', policy._id, policy.notified).then(function() {
      let message = type === 'present' ? 'Information about policy '+policy.name+' has been presented':
        'Policy '+policy.name+' has been '+type+'ed';
      Meteor.callAsync('logEvent', user, message, 'policy'+Utils.capitalizeFirstLetter(type)+'ed');
    }).catch(function(error) {
      let textError = 'Error: ' + (error.reason || ' could not '+ type +' policy by '+userName);
      Meteor.callAsync('logEvent', user, textError, 'policyConfirmed');
    }).finally(function() {
      if(!present){
        getLastPolicy();
      }
    });
  }
  return Promise.resolve();
}

Template.policyNotification.onRendered(function () {
  // Rendered by the layout on every hard reload, while the stored login token is still
  // resuming: an ungated call reaches the server anonymous and is refused with 401.
  // Meteor.userId() alone is not enough (restored from localStorage before the resume
  // completes); both are reactive, so the autorun fetches once login lands.
  this.autorun(function () {
    if (Meteor.loggingIn() || !Meteor.userId()) return;
    getLastPolicy();
  });

  $('#notifyPolicyForm').validate({
    rules: {},
    submitHandler: function () {
      const user = Meteor.user();
      let btn = $('.btn-confirm-policy');
      btn.prop('disabled', true).html('<i class="fa fa-spinner fa-spin"></i> Confirming...');
      policyUpdateNotified(user,'confirm').then(function() {
        $('#notifyPolicy').modal('hide');
      }).finally(function() {
        btn.prop('disabled', false).html('Confirm');
      });
    }
  });

  // Modals are moved to <body> on show (global handler) - Template.events
  // never fires inside. Bind delegated handlers on the modal element itself.
  $('#notifyPolicy').off('.policyNotification')
    .on('click.policyNotification', '.view-file', function () {
      const user = Meteor.user();
      Session.set('fileIsViewed',true);
      policyUpdateNotified(user,'view');
    })
    .on('submit.policyNotification', '#notifyPolicyForm', function (event) {
      event.preventDefault();
    })
    .on('show.bs.modal.policyNotification', function () {
      $('#notifyPolicyForm').validate().resetForm();
      Session.set('fileIsViewed');
    })
    .on('hidden.bs.modal.policyNotification', function () {
      const user = Meteor.user();
      if (user) policyUpdateNotified(user, 'present');
    });
});

Template.policyNotification.onDestroyed(function () {
  $('#notifyPolicy').off('.policyNotification');
});


Template.policyNotification.helpers({
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  policy: function () {
    return new PolicyItem(Session.get('newPolicyUpdates'))
  },
  getDateFormated: function (date, day) {
    return (!day)? moment(date).format('lll') : moment(date).format('ll')
  },
  fileIsNotViewed: function () {
    const user = Meteor.user();
    if(user){
      let currentUserPolicy = {};
      if(Session.get('newPolicyUpdates')){
        let notified = Session.get('newPolicyUpdates').notified;
        if(notified){
          currentUserPolicy = _.find(notified,function (item) {
            return item.userId === user._id
          });
        }
        return !(Session.get('fileIsViewed') || currentUserPolicy && currentUserPolicy.viewedDate)
      }
    }
  },
  getFile: function (policy) {
    return policy && policy.fileData() && policy.fileData().url()
  }
});

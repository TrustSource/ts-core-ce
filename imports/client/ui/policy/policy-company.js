import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';

import _ from 'underscore';
import Utils from '/imports/lib/utils';
import {Session} from 'meteor/session';


function policyUpdateNotified(policy, user,type) {
  const userName = (user.profile.name || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  if (policy){
    let currentUserPolicy = {};
    if(!policy.notified){
      policy.notified = [];
    }else{
      currentUserPolicy = _.find(policy.notified,function (item) {
        return item.userId === user._id
      });
      if(currentUserPolicy){
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
    Meteor.callAsync('Policy.UpdateNotified', policy._id, policy.notified).then(function() {
      let message = type === 'present' ? 'Information about policy '+policy.name+' has been presented':
        'Policy '+policy.name+' has been '+type+'ed';
      Meteor.callAsync('logEvent', user, message, 'policy'+Utils.capitalizeFirstLetter(type)+'ed');
    }).catch(function(error) {
      let textError = 'Error: ' + (error.reason || ' could not '+ type +' policy by '+userName);
      Meteor.callAsync('logEvent', user, textError, 'policyConfirmed');
    });
  }
}

Template.openSourcePolicy.onCreated(function () {
  Meteor.callAsync('getCompanyAccountAdmin').then(function(result) {
    return Session.set('companyAccountAdmin', result);
  }).catch(function(error) {
    console.log(error);
    return Session.set('companyAccountAdmin');
  });
  Meteor.callAsync('getCompanyComplianceManager').then(function(result) {
    return Session.set('companyComplianceManager', result);
  }).catch(function(error) {
    console.log(error);
    return Session.set('companyComplianceManager');
  });
});

Template.openSourcePolicy.helpers({

  getDateFormat: function (date, day) {
    return (!day)? moment(date).format('lll') : moment(date).format('ll')
  },
  getFile: function () {
    return this.fileData() && this.fileData().url()
  },
  accountAdminEmail: function () {
    return Session.get('companyAccountAdmin')
  },
  complianceManagerEmail: function () {
    return Session.get('companyComplianceManager')
  }
});
Template.openSourcePolicy.events({
  'click .view-file': function () {
    const user = Meteor.user();
    const policy = this;
    policyUpdateNotified(policy, user,'view');
  }
});

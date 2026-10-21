import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';

const BG_VIOLATIONS = 'bg-violations'
const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';

Template.moduleDependenciesAsideLogs.onRendered(function () {
  Session.set('showAllAsideLogs', false)
  const template = Template.instance();
  const component = template.data.data();
  Meteor.callAsync(
    'logEventsByModule',
    Router.current().params.moduleId,
    component && component.key,
    false
  ).then(data => {
    Session.set('logEventsByModule', data)
  }).catch(_error => {
    Session.set('logEventsByModule', [])
  })
});

Template.moduleDependenciesAsideLogs.helpers({
  getLogs: function () {
    return Session.get('logEventsByModule');
  },
  showAllAsideLogs: function () {
    return Session.get('showAllAsideLogs');
  },

  getLogType: function (object) {
    return object.typeLabel ? object.typeLabel : object.type
  },

  timelineIcon : function(){
    return hasError(this) ? 'fa-exclamation' : 'fa-check'
  },

  timelineClass : function(){
    return hasError(this) ? BG_VIOLATIONS : 'bg-primary'
  },

  getUserNameLog: function () {
    const user = Meteor.users.findOne(this.userId);
    return  (this.userName || (user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email) || 'User')
  }
});
Template.moduleDependenciesAside.events({
  'click .show_all_module_logs': function (event) {
    event.preventDefault();
    Session.set('showAllAsideLogs', true)
    const template = Template.instance();
    const componentKey = template.data.componentKey;
    $(event.target).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    Meteor.callAsync('logEventsByModule', Router.current().params.moduleId, componentKey, true).then(data => {
      Session.set('logEventsByModule', data)
    }).catch(_error => {
      Session.set('logEventsByModule', [])
    }).finally(() => {
      Meteor.setTimeout(function () {
        $(ASIDE_CLASS).removeClass(IN_PROGRESS);
      },1)
    })
  }
});

function hasError(log) {
  return log.message.indexOf('Error') > -1
}

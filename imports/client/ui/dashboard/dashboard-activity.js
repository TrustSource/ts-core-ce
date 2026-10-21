import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import LogEvents from '/imports/lib/collections/logevents';


Template.dashboardActivity.onRendered(function () {});

Template.dashboardActivity.events({});

function hasError(log) {
  return log.message.indexOf('Error') > -1
}

Template.dashboardActivity.helpers({
  getLogs: function(){
    const user = Meteor.user();
    if(user){
      return LogEvents.find({companyId : user.profile.companyId}, {sort: {date: -1}, limit: 10}).fetch()
    }
  },
  timelineIcon: function(){
    return hasError(this) ? 'fa-exclamation' : 'fa-check'
  },
  timelineClass: function(){
    return hasError(this) ? 'bg-violations' : 'bg-ok'
  },
  getName: function () {
    const user = Meteor.user();
    return this.userName || user.profile.email ||'User'
  },
  getLogType: function (object) {
    return object.typeLabel ? object.typeLabel : object.type
  }
});

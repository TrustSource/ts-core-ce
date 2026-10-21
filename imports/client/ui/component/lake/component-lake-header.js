import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {moment} from 'meteor/momentjs:moment';

// Shared header for every components lake screen. The count is the
// installation's shared component catalogue, which every user can read.

let nextComponentCountUpdate;
Session.set('componentCount');

Template.componentLakeHeader.onCreated(function () {
  if (Session.get('componentCount') === undefined) {
    Meteor.callAsync('countComponents').then(function (data) {
      if (data !== undefined) {
        Session.set('componentCount', data);
        nextComponentCountUpdate = moment().add(360, 'seconds').toDate();
      }
    });
  }
});

Template.componentLakeHeader.helpers({
  countComponents: function () {
    if (nextComponentCountUpdate && new Date() > nextComponentCountUpdate) {
      Session.set('componentCount');
    }
    const count = Session.get('componentCount');
    return (count && count.toLocaleString()) || 0;
  },
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId;
  }
});

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Updates from '/imports/lib/collections/updates';
import MessagesAnyNew from '/imports/lib/interactors/messages/anyNew';
import {toggleGuidePanel} from './guide/guide-panel';

Template.rightBar.onCreated(function () {
  // Part of the layout, so it is created on every hard reload - while the stored login token
  // is still resuming. Meteor.userId() is restored from localStorage before the connection is
  // authenticated, so gate on both: the server refuses an anonymous call with 401, and both
  // are reactive, so the autorun calls once login lands.
  this.autorun(function () {
    if (Meteor.loggingIn() || !Meteor.userId()) return;
    Meteor.callAsync('getCompanyAccountAdmin').then(function(result) {
      return Session.set('companyAccountAdmin', result);
    }).catch(function(error) {
      console.log(error);
      return Session.set('companyAccountAdmin');
    });
  });
});

Template.rightBar.events({
  'click .toggle-guide-panel': function (event) {
    event.preventDefault();
    toggleGuidePanel();
  },
  'click #logoutRightBar': function (event) {
    event.preventDefault();
    Meteor.logout(function () {
      Router.go('home');
    });
  }
});

Template.rightBar.helpers({
  haveNewMessages: function () {
    let user = Meteor.user();
    return user ? MessagesAnyNew(user._id) : false;
  },
  haveNewUpdates: function () {
    let user = Meteor.user();
    if (user) {
      let list = Updates.findOne({viewedBy: {$ne: user._id}});
      return list && list._id;
    }
    return false;
  },
  accountAdminEmail: function () {
    return Session.get('companyAccountAdmin');
  },
  guidePanelOpen: function () {
    return !!Session.get('guidePanelOpen');
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';

Template.companyComponentManagerDetailsHeader.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  routeParams: function () {
    return { _id : Router.current().params._id }
  }
});

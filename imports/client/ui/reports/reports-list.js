import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';

Template.reportsList.onRendered(function () {
  $('.panel-body').tooltip({
    selector: '[data-toggle=tooltip]'
  });
});

Template.reportsList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  possibleCriticalComponents: function () {
    let user = Meteor.user();
    return user && user.profile &&
      Roles.userIsInRole(user, ['company_component_manager'], user.profile.companyId);
  }
});

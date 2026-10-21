import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';

Template.companyIntegrations.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';

Template.companyGeneralInfo.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId;
  }
});

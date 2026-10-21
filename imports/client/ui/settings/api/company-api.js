import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';

Template.companyApi.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});


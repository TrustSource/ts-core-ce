import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';

Template.companyQualityLists.onRendered(function () {
  Meteor.callAsync('QualityProperties.Find', {}).then(function (results) {
    Session.set('getQualitySettingsList', results);
  });
});

Template.companyQualityLists.helpers({
  getQualitySettingsList: function () {
    return Session.get('getQualitySettingsList');
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Companies from '/imports/lib/collections/companies';

Template.companyEncryptionLists.onRendered(function () {
  Meteor.callAsync('CryptoProperties.Find', {}).then(function (results) {
    Session.set('getAlgorithmSettingsList', results);
  });
});

Template.companyEncryptionLists.helpers({
  getCompany() {
    return Companies;
  }
});

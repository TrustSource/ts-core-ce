import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {moment} from 'meteor/momentjs:moment';
import Notify from '/imports/api/notify';
import Clipboard from 'clipboard';

Template.companyPrivateLicenses.onCreated(function () {
  let clipboard = new Clipboard('.copy-license-key');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});


Template.companyPrivateLicenses.helpers({
  getPrivateLicenses: function () {
    const items = this.privateLicenses || [];
    return _.map(items, function (value, index) {
      value.index = index;
      return value
    });
  },
  getPrivateLicensesTotal: function () {
    const items = this.privateLicenses || [];
    return items && items.length
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getTime: function (value) {
    return moment(value).format('lll')
  },
  isDefaultRootLicense: function (key) {
    const company = Session.get('company');
    return company && company.defaultRootComponentLicense === key;
  }
});

Template.companyPrivateLicenses.events({
  'click .delete-license': function () {
    const self = this;
    Meteor.callAsync('privateLicenses.delete', self.key).then(function() {
      const user = Meteor.user();
      Notify.success('Private license deleted');
      Meteor.callAsync('logEvent', user, 'Private license '+self.key+' deleted', 'privateLicensesProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: ' + error.message, 'privateLicensesProcessing');
    });
  },
  'change #defaultRootComponentLicense': function (event) {
    const user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    const value = event.target.value || '';
    Meteor.callAsync('Companies.UpdateDefaultRootComponentLicense', companyId, value)
      .then(function () {
        Notify.success(value
          ? 'Default root-component license set to "' + value + '"'
          : 'Default root-component license cleared');
        Meteor.callAsync('logEvent', user,
          'Default root-component license ' + (value ? 'set to ' + value : 'cleared'),
          'companyConfigUpdated');
      })
      .catch(function (error) {
        Notify.danger(error.reason || error.message);
      });
  }
});


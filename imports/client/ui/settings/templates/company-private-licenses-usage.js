import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';


Template.companyPrivateLicensesUsage.onRendered(function () {
  Meteor.callAsync('privateLicenses.usageStats').then(data => {
    Session.set('usageStats', data)
  })

  // Modals are moved to <body> on show (global handler) - Template.events
  // never fires inside. Bind delegated handlers on the modal element itself.
  $('#usagePrivateLicense').off('.companyPrivateLicensesUsage')
    .on('submit.companyPrivateLicensesUsage', '#usagePrivateLicenseForm', function (event) {
      event.preventDefault();
    })
    .on('show.bs.modal.companyPrivateLicensesUsage', function () { Session.set('usagePrivateLicenseMsg'); })
    .on('hidden.bs.modal.companyPrivateLicensesUsage', function () { Session.set('usagePrivateLicenseMsg'); });
});

Template.companyPrivateLicensesUsage.onDestroyed(function () {
  $('#usagePrivateLicense').off('.companyPrivateLicensesUsage');
});

Template.companyPrivateLicensesUsage.helpers({
  usageStats: function (){
    return Session.get('usageStats')
  },
  usageStatsTotal: function (){
    const total = Session.get('usageStats')
    return total && total.length
  },
  usagePrivateLicenseMsgType: function () {
    let msg = Session.get('usagePrivateLicenseMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  usagePrivateLicenseMsg: function () {
    return Session.get('usagePrivateLicenseMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

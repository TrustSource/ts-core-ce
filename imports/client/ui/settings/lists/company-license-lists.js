/* global swal:false*/

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Roles} from 'meteor/alanning:roles';
import {REQUIRE_WHITELIST_ROLES} from '/imports/lib/company/settingsAccess';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Companies from '/imports/lib/collections/companies';
import {BWLicenseEntrySchema} from '/imports/lib/schemas/bwlistSchema';
import Notify from '/imports/api/notify';

Template.companyLicenseLists.onRendered(function () {
  $('[data-toggle=popover]').popover();
});

Template.companyLicenseLists.helpers({
  getWhitelistedLicenses: function () {
    return this.licenseConfig && this.licenseConfig.whitelist || [];
  },
  getBlacklistedLicenses: function () {
    return this.licenseConfig && this.licenseConfig.blacklist || [];
  },
  getCompany() {
    return Companies;
  },
  getCompanyLicenseEntrySchema() {
    return BWLicenseEntrySchema;
  },
  cantEditRequireWhitelist: function () {
    const user = Meteor.user();
    return (!Roles.userIsInRole(user, REQUIRE_WHITELIST_ROLES, user.profile.companyId)) ? 'disabled' : '';
  },
  getUserCompany: function () {
    return Session.get('company');
  }
});

Template.companyLicenseLists.events({
  'click input[name="requireWhitelist"]': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    if (Roles.userIsInRole(user, REQUIRE_WHITELIST_ROLES, user.profile.companyId)) {
      swal({
        title: 'Are you sure you want to update Enforce allow settings?',
        text: 'This will re-process all modules of this company to update status of licenses!',
        type: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#2a94a2',
        confirmButtonText: 'Yes, update settings!'
      },
      function () {
        const u = Meteor.user();
        const company = Session.get('company');
        const requireWhitelist = !company.requireWhitelist;
        Meteor.callAsync('Companies.UpdateRequireWhitelist', company._id, requireWhitelist).then(() => {
          Meteor.callAsync('logEvent', u, 'Company ' + company.name + ' settings changed', 'companySettingsUpdated');
          Notify.success('Company setting successfully changed');
          $('#companyRequireWhitelist').prop('checked', requireWhitelist);
          Meteor.callAsync('getCompanyCurrent').then(data => {
            if (data) Session.set('company', data);
          });
          Meteor.callAsync('analyzeAllCompanyModules').then(function (data) {
            if (!data) {
              Notify.danger('Internal Error! The check service is not available.');
            }
          });
        }).catch((error) => {
          let message = 'Internal Error! Company settings not changed: ' + error.message;
          Notify.danger(message);
          Meteor.callAsync('logEvent', u, message, 'companySettingsUpdated');
        });
      });
    } else {
      Notify.danger('You are not allowed to change this settings!');
    }
  }
});

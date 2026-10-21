import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {userSchema} from '/imports/lib/schemas/userSchema';
import {BWLicenseEntrySchema, BWComponentEntrySchema} from '/imports/lib/schemas/bwlistSchema';

Template.profileLists.onRendered(function () {
  $('[data-toggle=popover]').popover();
});

Template.profileLists.helpers({
  getWhitelistedComponents: function () {
    return this.componentConfig && this.componentConfig.whitelist || [];
  },

  getBlacklistedComponents: function () {
    return this.componentConfig && this.componentConfig.blacklist || [];
  },

  getWhitelistedLicenses: function () {
    return this.licenseConfig && this.licenseConfig.whitelist || [];
  },

  getBlacklistedLicenses: function () {
    return this.licenseConfig && this.licenseConfig.blacklist || [];
  },

  getComponentWhitelistTooltip: function () {
    return {
      title: 'Always allow component',
      content: `In the 'Always allow component' you specify components which are allowed, i.e not included in the
          result evaluation.<br /> You have to enter a key and a version to identify allowed components. In key
          expressions a wildcard character ('*')<br /> is allowed for every part (separated by ':') as last character.
          In the version field only one wildcard charachter ('*') is<br /> allowed and it must be the last character
          of the expression.
          <ul>Some examples for key entries:
            <li>mvn:my.compnanies.groupId:*</li>
            <li>*:mycompany:*</li>
          </ul>
          <ul> Some examples for version entries:
            <li>*</li>
            <li>1.*</li>
            <li>3.6.*</li>
          </ul>`
    };
  },

  getComponentBlacklistTooltip: function () {
    return {
      title: 'Always deny component',
      content: `In the 'Always deny component' you specify components which are denied, i.e always forced to fail in
          the result evaluation.<br /> You have to enter a key and a version to identify denied components. In key
          expressions a wildcard character ('*')<br /> is allowed for every part (separated by ':') as last character.
          In the version field only one wildcard charachter ('*') is<br /> allowed and it must be the last character of
          the expression.
          <ul>Some examples for key entries:
            <li>mvn:my.compnanies.groupId:*</li>
            <li>*:mycompany:*</li>
          </ul>
          <ul> Some examples for version entries:
            <li>*</li>
            <li>1.*</li>
            <li>3.6.*</li></ul>`
    };
  },

  getUser() {
    return Meteor.user();
  },

  getUserSchema() {
    return userSchema;
  },

  getUserComponentEntrySchema() {
    return BWComponentEntrySchema;
  },

  getUserLicenseEntrySchema() {
    return BWLicenseEntrySchema;
  }
});

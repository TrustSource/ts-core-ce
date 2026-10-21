import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';

import Notify from '/imports/api/notify';

Template.companyDetailsForm.events({
  'submit .company-details': function (event) {
    event.preventDefault();
    const company = this;
    const form = $(event.target);
    const details = {
      name: form.find('[name=companyName]').val(),
      email: form.find('[name=companyEmail]').val(),
      logoUrl: form.find('[name=logoUrl]').val()
    };
    Meteor.callAsync('Companies.UpdateDetails', company._id, details).then(() => {
      Notify.success('Company changed');
      Meteor.callAsync('logEvent', Meteor.user(), 'Company ' + details.name.trim() + ' details changed', 'companySettingsUpdated');
      // Keep the app-wide company snapshot in sync with what was just saved. It is
      // only fetched once per page load, so views reading it (company name in the
      // sidebar) would otherwise show pre-save data until the page is reloaded.
      return Meteor.callAsync('getCompanyCurrent');
    }).then((current) => {
      if (current) Session.set('company', current);
    }).catch((error) => {
      Notify.danger(error.reason || error.message);
      Meteor.callAsync('logEvent', Meteor.user(), 'Error: ' + (error.reason || error.message), 'companySettingsUpdated');
    });
  }
});

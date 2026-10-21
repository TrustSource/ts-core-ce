import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

import Notify from '/imports/api/notify';

Template.companyFoss.events({
  'submit .foss': function (event) {
    event.preventDefault();
    let company = this;
    let form = $(event.target);
    const data = {
      foss: {
        name: form.find('[name=fossName]').val(),
        company: form.find('[name=fossCompanyName]').val(),
        email: form.find('[name=fossEmail]').val(),
        phone: form.find('[name=fossPhone]').val(),
        zip: form.find('[name=fossZIP]').val(),
        address: form.find('[name=fossAddress]').val(),
        country: form.find('[name=fossCountry]').val(),
        url: form.find('[name=fossUrl]').val()
      }
    };
    Meteor.callAsync('Companies.UpdateFoss', company._id, data).then(() => {
      const user = Meteor.user();
      Notify.success('FOSS settings updated');
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' FOSS settings changed', 'fossSettingsUpdated');
    }).catch((error) => {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'fossSettingsUpdated');
    });
  }
});

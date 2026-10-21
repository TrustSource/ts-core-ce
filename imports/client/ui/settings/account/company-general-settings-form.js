import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

import Notify from '/imports/api/notify';

Template.companyGeneralSettingsForm.events({
  'submit .general_settings': function (event) {
    event.preventDefault();
    let company = this;
    let form = $(event.target);
    const data = {
      distribution: {
        email: form.find('[name=distributionEmail]').val()
      },
      currencyCode: form.find('[name=currencyCode]').val()
    };
    Meteor.callAsync('Companies.UpdateGeneralSettings', company._id, data).then(() => {
      const user = Meteor.user();
      Notify.success('Distribution settings updated');
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' General settings changed', 'companySettingsUpdated');
    }).catch((error) => {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'companySettingsUpdated');
    });
  }
});

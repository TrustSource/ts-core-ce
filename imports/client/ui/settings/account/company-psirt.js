import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

import Notify from '/imports/api/notify';


Template.companyPsirt.events({
  'submit .psirt': function (event) {
    event.preventDefault();
    let company = this;
    let form = $(event.target);
    const data = {
      psirt: {
        registeredTradeName: form.find('[name=registeredTradeName]').val(),
        manufacturerName: form.find('[name=manufacturerName]').val(),
        manufacturerAddress: form.find('[name=manufacturerAddress]').val(),
        manufacturerWebsite: form.find('[name=manufacturerWebsite]').val(),
        productSecurityContact: form.find('[name=productSecurityContact]').val(),
        productSecurityWeblink: form.find('[name=productSecurityWeblink]').val()
      }
    };
    Meteor.callAsync('Companies.UpdatePsirt', company._id, data).then(() => {
      const user = Meteor.user();
      Notify.success('PSIRT settings updated');
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' PSIRT settings changed', 'psirtSettingsUpdated');
    }).catch((error) => {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'psirtSettingsUpdated');
    });
  }
});

Template.companyPsirt.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  psirt: function () {
    return this.psirt || {}
  }
});

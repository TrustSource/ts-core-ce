import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyIntegrationsScanoss.events({
  'submit .scanoss': function (event) {
    event.preventDefault();
    let company = this;
    let scanoss = {
      token: $(event.target).find('[name=scanoss-token]').val(),
      active: $(event.target).find('[name=scanoss-active]').prop('checked')
    };
    Meteor.callAsync('Companies.UpdateScanoss', scanoss).then(function() {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' scanoss settings changed', 'scanossSettingsUpdated');
      Notify.success('Company changed');
    }).catch(function(error) {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'scanossSettingsUpdated');
      Notify.danger(error.message);
    });
  }
});

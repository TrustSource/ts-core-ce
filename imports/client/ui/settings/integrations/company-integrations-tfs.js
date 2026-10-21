import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import collectionUrl from '/imports/lib/tfs/collectionUrl';

Template.companyIntegrationsTfs.onRendered(function () {
  Meteor.setTimeout(function () {
    $('.i-checks').iCheck({
      checkboxClass: 'icheckbox_square-green',
      radioClass: 'iradio_square-green'
    });
  },1);
});
Template.companyIntegrationsTfs.events({
  'submit .tfs': function (event) {
    event.preventDefault();
    let company = this;
    let tfs = {
      account: $(event.target).find('[name=tfs-account]').val(),
      project: $(event.target).find('[name=tfs-project]').val(),
      token: $(event.target).find('[name=tfs-token]').val(),
      active: $(event.target).find('[name=tfs-active]').prop('checked')
    };
    Meteor.callAsync('Companies.UpdateTfs', tfs).then(function() {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Company '+company.name+' TFS settings changed', 'tfsSettingsUpdated');
      Notify.success('Company changed');
      $('.tfs-account-result').html('');
    }).catch(function(error) {
      const user = Meteor.user();
      Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'tfsSettingsUpdated');
      Notify.danger(error.message);
    });
  },
  'keyup #tfs-account': function (event) {
    $('.tfs-account-result').html(collectionUrl(event.target.value));
  }
});
Template.companyIntegrationsTfs.helpers({
  tfsAccountResult: function () {
    return collectionUrl(this && this.tfs && this.tfs.account);
  }
});

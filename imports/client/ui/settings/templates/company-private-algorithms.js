import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {moment} from 'meteor/momentjs:moment';
import Notify from '/imports/api/notify';
import Clipboard from 'clipboard';

Template.companyPrivateAlgorithms.onCreated(function () {
  let clipboard = new Clipboard('.copy-algorithm-key');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

Template.companyPrivateAlgorithms.onRendered(function () {
  $('#addPrivateAlgorithmForm').validate({
    rules: {
      newPrivateName: {
        required: true,
        minlength: 1
      },
      newPrivateStrength: {
        required: false
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const key = $(form).find('[name=newPrivateName]').val();
      const strength = $(form).find('[name=newPrivateStrength]').val();
      Meteor.callAsync('privateAlgorithms.create', key, strength).then(function(data) {
        const user = Meteor.user();
        Notify.success('Private algorithm created');
        Meteor.callAsync('logEvent', user, 'New private algorithm '+data.key+' created', 'privateAlgorithmsProcessing');
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'privateAlgorithmsProcessing');
      });
      $('#addPrivateAlgorithmForm')[0].reset();
    }
  });
});


Template.companyPrivateAlgorithms.helpers({
  getPrivateAlgorithms: function () {
    const apiKeys = this.privateAlgorithms || [];
    return _.map(apiKeys, function (value, index) {
      value.index = index;
      return value
    });
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getTime: function (value) {
    return moment(value).format('lll')
  }
});

Template.companyPrivateAlgorithms.events({
  'click .delete-algorithm': function () {
    const self = this;
    Meteor.callAsync('privateAlgorithms.delete', self.key).then(function() {
      const user = Meteor.user();
      Notify.success('Private algorithm deleted');
      Meteor.callAsync('logEvent', user, 'Private algorithm '+self.key+' deleted', 'privateAlgorithmsProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: ' + error.message, 'privateAlgorithmsProcessing');
    });
  },
  'submit #addPrivateAlgorithmForm': function (event) {
    event.preventDefault();
  }
});


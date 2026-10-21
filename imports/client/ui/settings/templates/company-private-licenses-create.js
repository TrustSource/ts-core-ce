import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

function createPrivateLicense(key, description) {
  Meteor.callAsync('privateLicenses.create', key, description).then(function(data) {
    const user = Meteor.user();
    Notify.success('Private license created');
    Meteor.callAsync('logEvent', user, 'New private license '+data.key+' created', 'privateLicensesProcessing');
    Meteor.setTimeout(function () {
      $('#createPrivateLicense').modal('hide');
    }, 300);
  }).catch(function(error) {
    const user = Meteor.user();
    Notify.danger(error.message);
    Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'privateLicensesProcessing');
  });
}

// The modal is rendered inside a role check, so on a direct page load it does not
// exist yet when this template renders, and it is moved to <body> on show (global
// handler), where Template.events never fire. Everything is therefore set up on the
// modal element when the button opens it.
function initForm() {
  const form = $('#createPrivateLicenseForm');
  if (!form.length || form.data('validator')) {
    return;
  }
  form.validate({
    rules: {
      newPrivateLicense: {
        required: true,
        minlength: 1
      },
      newPrivateLicenseDescription: {
        required: false,
        minlength: 0
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
      const key = $(form).find('[name=newPrivateLicense]').val();
      const description = $(form).find('[name=newPrivateLicenseDescription]').val();
      Meteor.callAsync('countLicenseByNameOrKeyOrAlias', key).then(function(data) {
        if (data && data > 0) {
          Notify.danger('Error: License is already available in the system');
        }else {
          createPrivateLicense(key, description);
        }
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'privateLicensesProcessing');
      })
    }
  });
}

Template.companyPrivateLicensesCreate.events({
  'click .showCreatePrivateLicense': function (event) {
    event.preventDefault();
    const modal = $('#createPrivateLicense');
    initForm();
    modal.find('.select2').select2({width: '100%'});
    modal.off('.companyPrivateLicensesCreate')
      .on('show.bs.modal.companyPrivateLicensesCreate', function () {
        $('#createPrivateLicenseForm').validate().resetForm();
        modal.find('[name=newPrivateLicense]').val('').removeClass('error');
        modal.find('[name=newPrivateLicenseDescription]').val('').removeClass('error');
        Session.set('createPrivateLicenseMsg');
      })
      .on('hidden.bs.modal.companyPrivateLicensesCreate', function () {
        Session.set('createPrivateLicenseMsg');
      });
    modal.modal('show');
  }
});

Template.companyPrivateLicensesCreate.onDestroyed(function () {
  $('#createPrivateLicense').off('.companyPrivateLicensesCreate');
});

Template.companyPrivateLicensesCreate.helpers({

  createPrivateLicenseMsgType: function () {
    let msg = Session.get('createPrivateLicenseMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createPrivateLicenseMsg: function () {
    return Session.get('createPrivateLicenseMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

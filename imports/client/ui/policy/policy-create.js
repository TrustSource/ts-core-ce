import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Policy from '/imports/lib/collections/policy';
import policyFiles from '/imports/lib/collections/policyFiles';
import Notify from '/imports/api/notify';
import UserExtUtils from '/imports/lib/userExtUtils';

function handlePolicyUploadEnd(error, fileObj, user, policyName, policyNotify, policyDescription) {
  if (error) {
    let textError = 'Error: ' + (error.reason || ' could not upload policy file');
    Meteor.callAsync('logEvent', user, textError, 'policyCreated');
    Notify.danger(textError);
    return;
  }
  const userName = (user.profile.name || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
  Policy.insertAsync({
    active:false,
    name: policyName,
    notify: policyNotify,
    description: policyDescription,
    companyId: Meteor.user().profile.companyId,
    creationDate: new Date(),
    updatedDate: new Date(),
    file: fileObj._id,
    notified: [
      {
        userId: user._id,
        name: userName,
        confirmedDate: new Date(),
        presentedDate: new Date()
      }
    ]
  }).then(function () {
    Meteor.callAsync('logEvent', user, 'New policy '+policyName+' has been created', 'policyCreated');
    Notify.success('Policy successfully created!');
    Meteor.setTimeout(function () {
      $('#createPolicy').modal('hide');
    }, 300);
  }).catch(function (insertError) {
    let textError = 'Error: ' + (insertError.reason || ' could not create policy');
    Meteor.callAsync('logEvent', user, textError, 'policyCreated');
    Notify.danger(textError);
  })
}

// The modal is rendered inside a role check, so on a direct page load it does not
// exist yet when this template renders, and it is moved to <body> on show (global
// handler), where Template.events never fire. Everything is therefore set up on the
// modal element when the button opens it.
function initForm() {
  const form = $('#createPolicyForm');
  if (!form.length || form.data('validator')) {
    return;
  }
  form.validate({
    rules: {
      policyName: {
        required: true,
        minlength: 3
      },
      policyDocument: {
        required: true,
        minlength: 1
      },
      policyNotify: {
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
      const user = Meteor.user();
      const policyName = $(form).find('[name=policyName]').val();
      const file = $(form).find('[name=policyDocument]')[0].files[0];
      if (Policy.findOne({name: policyName})) {
        Notify.danger('Error: policy with same name already exists');
      } else {
        const policyNotify = $(form).find('[name=policyNotify]').val();
        const policyDescription = $(form).find('[name=policyDescription]').val();
        const upload = policyFiles.insert({
          file: file,
          chunkSize: 'dynamic'
        }, false);
        upload.on('error', function (error) {
          let reason = error.reason || error.message || 'could not upload policy file';
          let textError = 'Error: ' + reason;
          Meteor.callAsync('logEvent', user, textError, 'policyCreated');
          Notify.danger(textError);
        });
        upload.on('end', function (error, fileObj) {
          handlePolicyUploadEnd(error, fileObj, user, policyName, policyNotify, policyDescription);
        });
        upload.start();
      }
    }
  });
}

Template.policyCreate.events({
  'click .showCreatePolicy': function (event) {
    event.preventDefault();
    const modal = $('#createPolicy');
    initForm();
    modal.find('.select2').select2({width: '100%'});
    modal.off('.policyCreate')
      .on('show.bs.modal.policyCreate', function () {
        $('#createPolicyForm').validate().resetForm();
        modal.find('[name=policyName]').val('').removeClass('error');
        modal.find('[name=policyNotify]').val('').removeClass('error');
        modal.find('[name=policyDescription]').val('').removeClass('error');
        Session.set('createPolicyMsg');
      })
      .on('hidden.bs.modal.policyCreate', function () {
        Session.set('createPolicyMsg');
      })
      .on('change.policyCreate', 'input[name=policyDocument]', function () {
        modal.find('input[name=filename]').val(this.files[0] ? this.files[0].name : '');
      });
    modal.modal('show');
  }
});

Template.policyCreate.helpers({

  createPolicyMsgType: function () {
    let msg = Session.get('createPolicyMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createPolicyMsg: function () {
    return Session.get('createPolicyMsg');
  },

  getRolesSchema: function () {
    return UserExtUtils.availableRoles()
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

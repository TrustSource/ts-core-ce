import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import Notify from '/imports/api/notify';


// The modal is rendered inside a role check, so on a direct page load it does not
// exist yet when this template renders, and it is moved to <body> on show (global
// handler), where Template.events never fire. Everything is therefore set up on the
// modal element when the button opens it.
function initForm() {
  const form = $('#createTemplateForm');
  if (!form.length || form.data('validator')) {
    return;
  }
  form.validate({
    rules: {
      templateName: {
        required: true,
        minlength: 3
      },
      templateType: {
        required: true
      },
      templateOrder: {
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
      const user = Meteor.user();
      const templateName = $(form).find('[name=templateName]').val();
      const templateType = $(form).find('[name=templateType]').val();
      const templateOrder = $(form).find('[name=templateOrder]').val();
      if (LegalSettingsTemplates.findOne({name: templateName})) {
        Notify.danger('Error: template with same name already exists');
      } else {
        const companyId = user.profile.companyId
        LegalSettingsTemplates.insertAsync({
          name: templateName,
          type: templateType,
          order: templateOrder,
          companyId
        }).then(function () {
          Meteor.callAsync('logEvent', user, 'New template '+templateName+' has been created', 'legalSettingsTemplateCreated');
          Notify.success('New template '+templateName+' has been created');
          Meteor.setTimeout(function () {
            $('#createTemplate').modal('hide');
          }, 300);
        }).catch(function (error) {
          let textError = 'Error: ' + (error.reason || ' could not create template');
          Meteor.callAsync('logEvent', user, textError, 'legalSettingsTemplateCreated');
          Notify.danger(textError);
        })
      }
    }
  });
}

Template.companyLegalTemplatesCreate.events({
  'click .showCreateTemplate': function (event) {
    event.preventDefault();
    const modal = $('#createTemplate');
    initForm();
    modal.find('.select2').select2({width: '100%'});
    modal.off('.companyLegalTemplatesCreate')
      .on('show.bs.modal.companyLegalTemplatesCreate', function () {
        $('#createTemplateForm').validate().resetForm();
        modal.find('[name=templateName]').val('').removeClass('error');
        modal.find('[name=templateType]').val('').removeClass('error');
        modal.find('[name=templateOrder]').val('').removeClass('error');
        Session.set('createTemplateMsg');
      })
      .on('hidden.bs.modal.companyLegalTemplatesCreate', function () {
        Session.set('createTemplateMsg');
      });
    modal.modal('show');
  }
});

Template.companyLegalTemplatesCreate.onDestroyed(function () {
  $('#createTemplate').off('.companyLegalTemplatesCreate');
});

Template.companyLegalTemplatesCreate.helpers({

  createTemplateMsgType: function () {
    let msg = Session.get('createTemplateMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createTemplateMsg: function () {
    return Session.get('createTemplateMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

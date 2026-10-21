import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';

// The modal ids are this template's own: the module page's componentCreate binds
// document-wide listeners on #createComponent, and would otherwise take over this
// form with its own submit handler.
const MODAL = '#createLakeComponent';
const FORM = '#createLakeComponentForm';

function createComponentSubmit(form) {
  const now = new Date();
  const name = $(form).find('[name=componentName]').val();
  const key = $(form).find('[name=componentKey]').val();
  let versions = $(form).find('[name=componentVersions]').val();
  versions = _.map(versions.split(','),function (version) {
    return version ? {version: version.trim()} : null
  });
  const homepage = $(form).find('[name=componentHomepage]').val();
  const repository = $(form).find('[name=componentRepository]').val();
  const urls = {homepage, repository};
  const created = now;
  const createdBy = Utils.username();
  let component = {name, key, versions, created, createdBy, urls};
  Meteor.callAsync('Components.Create', component).then(function() {
    Notify.success('Component successfully created!');
    Meteor.callAsync('countComponents').then(function (count) {
      Session.set('componentCount', count);
    });
    Meteor.setTimeout(function () {
      $(MODAL).modal('hide');
    }, 300);
  }).catch(function(error) {
    const message = 'Error: ' + (error.reason || ' could not create component');
    Session.set('createComponentMsg', message);
    Notify.warn(message);
  });
}

// Initialised once per form element; a later open only resets it, so repeated
// opens never stack a second submit handler on the same form.
function initCreateComponentForm() {
  const form = $(FORM);
  if (!form.length) {
    return;
  }
  const validator = form.data('validator');
  if (validator) {
    validator.resetForm();
    return;
  }
  form.validate({
    rules: {
      componentName: {
        required: true,
        minlength: 1
      },
      componentKey: {
        required: true,
        minlength: 1
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: createComponentSubmit
  });
}

// The modal is rendered inside a role check, so it may not exist yet when this
// template renders, and it is moved to <body> on show (global handler), where
// Template.events never fire. Everything is therefore bound on the modal element
// when the button opens it.
Template.componentDetailsCreate.events({
  'click .showCreateLakeComponent': function (event) {
    event.preventDefault();
    const modal = $(MODAL);
    modal.off('.componentDetailsCreate')
      .on('show.bs.modal.componentDetailsCreate', function () {
        modal.find('input').val('').removeClass('error');
        Session.set('createComponentMsg');
      })
      .on('shown.bs.modal.componentDetailsCreate', initCreateComponentForm)
      .on('hidden.bs.modal.componentDetailsCreate', function () {
        Session.set('createComponentMsg');
      });
    modal.modal('show');
  }
});

Template.componentDetailsCreate.onDestroyed(function () {
  $(MODAL).off('.componentDetailsCreate');
});


Template.componentDetailsCreate.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  createComponentMsgType: function () {
    const msg = Session.get('createComponentMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createComponentMsg: function () {
    return Session.get('createComponentMsg');
  }
});

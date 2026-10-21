import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Random} from 'meteor/random';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import UserExtUtils from '/imports/lib/userExtUtils';

// Creating a key waits on a server round trip, and
// the modal stays open with the form filled the whole time, so a second Create
// click (or a second Enter in the name field) used to mint a second identical
// key.
//
// `creating` is the guard that actually holds: it is set synchronously inside
// the submit handler, whereas the disabled/spinner button below only appears
// after Blaze's next flush - a fast double click beats the repaint but not this.
let creating = false;
// Marks one "create a key" intent for the server to deduplicate against, which
// also covers the replay we cannot see from here: Meteor re-sends outstanding
// method calls after a dropped connection. Rotated per modal opening and after
// each key is made, so a deliberate second key is never mistaken for a replay.
let createRequestId = Random.id();

// The modal is rendered inside a role check, so on a direct page load it does not
// exist yet when this template renders, and it is moved to <body> on show (global
// handler), where Template.events never fire. Everything is therefore set up on the
// modal element when the button opens it.
function initCreateKeyForm() {
  const form = $('#createModalForm');
  if (!form.length || form.data('validator')) {
    return;
  }
  form.validate({
    rules: {
      nameModal: {
        required: true,
        minlength: 1
      },
      scopeModal: {
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
      if (creating) {
        return;
      }
      const name = $(form).find('[name=nameModal]').val();
      const scope = $(form).find('[name=scopeModal]').val();
      // Checked before the guard is raised - an early return here must leave the
      // form usable so the user can pick a scope and submit again.
      if(!scope || (scope && !scope.length)){
        Notify.warn('API key scope is required');
        return
      }
      creating = true;
      Session.set('apiKeyCreateDisabled', true);
      Meteor.callAsync('apiKey.create', {name, scope, requestId: createRequestId}).then(function(data) {
        const user = Meteor.user();
        createRequestId = Random.id();
        Notify.success('Api key created');
        Meteor.callAsync('logEvent', user, 'New Api key '+data.maskedKey+' created', 'apiKeyProcessing');
        Meteor.setTimeout(function () {
          $('#createModal').modal('hide');
        }, 300);
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'apiKeyProcessing');
      }).finally(function() {
        creating = false;
        Session.set('apiKeyCreateDisabled');
      });
    }
  });
}

Template.companyApiKeysCreate.events({
  'click .showCreateApiKey': function (event) {
    event.preventDefault();
    initCreateKeyForm();
    $('#createModal').off('.companyApiKeysCreate')
      .on('show.bs.modal.companyApiKeysCreate', function (event) {
        // A fresh opening is a new intent, so it must not dedupe against the last
        // one. `creating` is deliberately NOT cleared here - it always clears in
        // the call's own `finally`, and clearing it on reopen would re-arm the
        // button while the previous create is still in flight.
        createRequestId = Random.id();
        $('#createModalForm').validate().resetForm();
        $(event.target).find('[name=nameModal]').val('').removeClass('error');
        $(event.target).find('[name=scopeModal]').val('').trigger('change').removeClass('error');
        Session.set('createModalMsg');
        Meteor.setTimeout(()=>{
          $('.select2').select2({width: '100%'});
        },1)
      })
      .on('hidden.bs.modal.companyApiKeysCreate', function () {
        Session.set('createModalMsg');
      });
    $('#createModal').modal('show');
  }
});

Template.companyApiKeysCreate.onDestroyed(function () {
  $('#createModal').off('.companyApiKeysCreate');
});

Template.companyApiKeysCreate.helpers({

  // The button lives in THIS template, so the state has to be readable
  // here - Blaze does not fall through to a parent template's helpers.
  apiKeyCreateInProgress: function () {
    return Session.get('apiKeyCreateDisabled');
  },

  createModalMsgType: function () {
    let msg = Session.get('createModalMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createModalMsg: function () {
    return Session.get('createModalMsg');
  },

  apiKeyScopes: function () {
    return UserExtUtils.availableRolesKeys()
  },
  isSelectedScope: function (scope) {
    let keyScope = this.toString()
    return scope && scope.indexOf(keyScope) > -1
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

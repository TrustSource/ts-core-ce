import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import _ from 'underscore';
import moment from 'moment';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {copyRevealedKey} from '/imports/client/ui/common/reveal-copy';

const TLP_LEVELS = ['WHITE', 'GREEN', 'AMBER', 'RED'];

function currentCompanyId() {
  const user = Meteor.user();
  return user && user.profile && user.profile.companyId;
}

Template.companyApiCsaf.helpers({
  companyId: currentCompanyId
});

Template.companyCsafKeys.onCreated(function () {
  this.filterText = new ReactiveVar('');
});

Template.companyCsafKeys.onRendered(function () {
  // The create button now lives in the page header (opened via data-toggle),
  // so bind jquery-validation here once the modal is in the DOM.
  $('#createCsafKey').off('shown.bs.modal.csafInit').on('shown.bs.modal.csafInit', function () {
    const form = $('#createCsafKeyForm');
    if (form.length) {
      form.validate({submitHandler: createCsafKeySubmit});
    }
  });
});

Template.companyCsafKeys.helpers({
  getCsafKeys: function () {
    let keys = _.map(this.publicCsafKeys || [], function (value, index) {
      value.index = index;
      // Treat a key with no explicit published flag (created before this field
      // existed) as published; only an explicit false means unpublished.
      value.isPublished = value.published !== false;
      // The feed is read-only for now; default keys with no stored operations to 'view'.
      value.operations = (Array.isArray(value.operations) && value.operations.length) ? value.operations : ['view'];
      return value;
    });
    const filter = (Template.instance().filterText.get() || '').toLowerCase();
    if (filter) {
      keys = keys.filter(function (k) {
        return (k.name || '').toLowerCase().indexOf(filter) > -1 ||
          (k.maskedKey || '').toLowerCase().indexOf(filter) > -1 ||
          (k.tlpLevels || []).join(',').toLowerCase().indexOf(filter) > -1;
      });
    }
    // Newest first (matches the Created-descending default on the API keys page).
    return keys.sort(function (a, b) {
      const da = a.created ? new Date(a.created).getTime() : 0;
      const db = b.created ? new Date(b.created).getTime() : 0;
      return db - da;
    });
  },
  companyId: currentCompanyId,
  tlpLevelOptions: function () {
    return TLP_LEVELS;
  },
  formatCreated: function (created) {
    return created ? moment(created).format('lll') : '';
  },
  opLabel: function (op) {
    return op ? op.charAt(0).toUpperCase() + op.slice(1) : '';
  }
});

function createCsafKeySubmit(form) {
  const name = $('#csafKeyName').val();
  const tlpLevels = $('.new-csaf-tlp:checked').map(function () { return this.value; }).get();
  if (!tlpLevels.length) {
    Notify.warn('Select at least one TLP level');
    return;
  }
  Meteor.callAsync('publicCsafKey.create', name, tlpLevels).then(function () {
    Notify.success('CSAF feed key created');
    $('#createCsafKey').modal('hide');
    form.reset();
  }).catch(function (error) {
    Notify.danger(error.message);
  });
}

Template.companyCsafKeys.events({
  'input .csaf-filter-input': function (event, instance) {
    instance.filterText.set(event.target.value);
  },

  'click .copy-csaf-key': function () {
    copyRevealedKey('publicCsafKey.reveal', this.id);
  },

  'click .publish-csaf-key': function () {
    const key = this.id;
    Meteor.callAsync('publicCsafKey.setPublished', key, true).then(function () {
      Notify.success('CSAF feed key published');
    }).catch(function (error) {
      Notify.danger(error.message);
    });
  },

  'click .unpublish-csaf-key': function () {
    const key = this.id;
    Meteor.callAsync('publicCsafKey.setPublished', key, false).then(function () {
      Notify.success('CSAF feed key unpublished');
    }).catch(function (error) {
      Notify.danger(error.message);
    });
  },

  'click .delete-csaf-key': function () {
    const key = this.id;
    Meteor.callAsync('publicCsafKey.delete', key).then(function () {
      Notify.success('CSAF feed key deleted');
    }).catch(function (error) {
      Notify.danger(error.message);
    });
  }
});

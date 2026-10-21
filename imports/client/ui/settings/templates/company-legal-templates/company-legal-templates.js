/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyLegalTemplates.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.companyLegalTemplates.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.companyLegalTemplates.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('companyLegalTemplatesDetails', {legalSettingsTemplateId: this._id});
    }
  }
});

Template.companyLegalTemplates.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  reactiveTableSettings: function () {
    return {
      collection: this,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'order',
          key: 'order',
          label: 'order',
          cellClass: 'col-date'
        },
        {
          fieldId: 'type',
          key: 'type',
          label: 'Type',
          cellClass: 'col-date'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name'
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableCompanyLegalTemplatesActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableCompanyLegalTemplatesActions.events({
  'click .delete-template': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to delete template ' + self.name + '?',
      text: 'You will not be able to recover this rule!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('LegalSettingsTemplates.Remove', self._id).then(function() {
        Meteor.callAsync('logEvent', user, 'Template '+self.name+' has been deleted', 'legalSettingsTemplateDeleted');
        Notify.success('Template '+self.name+' has been deleted');
        Router.go('companyLegalTemplates');
      }).catch(function(err) {
        let textError = 'Error: ' + (err || ' could not delete template');
        Meteor.callAsync('logEvent', user, textError, 'legalSettingsTemplateDeleted');
        Notify.danger(textError);
      });
    });
  }
});

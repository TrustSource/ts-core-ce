import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {PolicySchema} from '/imports/lib/schemas/policySchema';
import {AutoForm} from 'meteor/aldeed:autoform';
import Notify from '/imports/api/notify';


Template.policyDetails.onRendered(function () {
  const form = $('#updatePolicyForm')[0];
  if (form) form.reset();
});

Template.policyDetails.helpers({

  getSchema: function () {
    return PolicySchema;
  },
  fields: function () {
    return 'active,name,description,notify'
  },
  disableOnConfirmations: function () {
    return !(!this.notified || this.notified && this.notified.length < 2)?'disabled':'method-update';
  },

  reactiveTableSettings: function () {
    return {
      collection: this.notified || [],
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'presentedDate',
          key: 'presentedDate',
          label: 'Presented',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'viewedDate',
          key: 'viewedDate',
          label: 'Viewed',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'confirmedDate',
          key: 'confirmedDate',
          label: 'Confirmed',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'User name'
        }
      ]
    };
  }
});

AutoForm.hooks({
  updatePolicyForm: {
    before: {
      'method-update': function (doc) {
        if (!this.docId) {
          this.docId = Router.current().params.policyId;
        }
        return doc;
      }
    },
    after: {
      'method-update': function (error) {
        if (error) {
          Notify.danger('Error: ' + (error.message || 'Policy not updated'));
        } else {
          Notify.success('Policy updated!');
        }
      }
    },
    onError: function (formType, error) {
      Notify.danger('Error: ' + (error.message || 'Policy not updated'));
    }
  }
});


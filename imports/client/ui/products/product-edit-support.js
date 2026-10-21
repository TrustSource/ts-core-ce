/* global window:false, document:false, Blob:false */
import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const LOADING = 'loadingInProgress'
const ERROR_REMOVING = 'Error removing support contract:'

Template.productEditSupport.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  reactiveTableSettings: function () {
    let supportContracts = this.supportContracts || []
    return {
      collection: supportContracts,
      rowsPerPage: 10,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Contract name'
        },
        {
          fieldId: 'endDate',
          key: 'endDate',
          label: 'End date',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description'
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'text-right col-actions-fixed',
          tmpl: Template.reactiveTableProductsSupportActions
        }
      ]
    };
  }
});

Template.productEditSupport.events({
  'click .generate_eol'() {
    let product = this;
    let supportContracts = product.supportContracts || []
    let today = new Date();
    let report = {
      '$schema': 'https://TODO/cle.v1.0.0.json',
      'identifier': product.identifier,
      'updatedAt': today.toISOString(),
      'definitions': {
        'support': []
      },
      'events': []
    }
    supportContracts.forEach((supportContract) => {
      report.definitions.support.push({
        'id': supportContract.name,
        'description': supportContract.description
      })
      if(supportContract.endDate){
        report.events.push({
          'id': report.events.length + 1,
          'type': 'endOfSupport',
          'effective': supportContract.endDate.toISOString(),
          'published': supportContract.endDate.toISOString(),
          'versions': [
            {
              'range': 'vers:all/*'
            }
          ],
          'supportId': supportContract.name
        })
      }
    })
    let FILE_NAME = '_eol_info'
    let blob = new Blob([JSON.stringify(report, null, 2)]);
    if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
      window.navigator.msSaveBlob(blob, product.identifier + FILE_NAME + '.json');
    else {
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
      a.download = product.identifier + FILE_NAME + '.json';
      document.body.appendChild(a);
      a.click();  // IE: "Access is denied";
      // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
      document.body.removeChild(a);
    }
  }
})

Template.reactiveTableProductsSupportActions.events({
  'click .remove-item'() {
    const support = this;
    let product = Template.parentData(5);
    let props = {
      support: {
        _id: support._id
      },
      product: {
        _id: product._id
      }
    }
    Meteor.callAsync('Products.SupportRemove', props, null).then(data => {
      if (data === 1) {
        Notify.success('Support contract successfully removed');
      } else {
        Notify.danger(ERROR_REMOVING);
      }
    })
  }
})

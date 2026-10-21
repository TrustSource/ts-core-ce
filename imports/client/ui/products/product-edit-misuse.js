import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const LOADING = 'loadingInProgress'
const ERROR_REMOVING = 'Error removing misuse case:'

Template.productEditMisuse.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  reactiveTableSettings: function () {
    let misuses = this.misuses || []
    return {
      collection: misuses,
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
          label: 'Case name'
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
          tmpl: Template.reactiveTableProductsMisuseActions
        }
      ]
    };
  }
});

Template.reactiveTableProductsMisuseActions.events({
  'click .remove-item' () {
    const misuse = this;
    let product = Template.parentData(5);
    let props = {
      misuse:{
        _id: misuse._id
      },
      product:{
        _id: product._id
      }
    }
    Meteor.callAsync('Products.MisuseRemove', props, null).then(data => {
      if (data === 1) {
        Notify.success('Misuse case successfully removed');
      } else {
        Notify.danger(ERROR_REMOVING);
      }
    })
  }
})

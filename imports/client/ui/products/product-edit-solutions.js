import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {Spacebars} from 'meteor/spacebars';
import Notify from '/imports/api/notify';

const LOADING = 'loadingInProgress'
const ERROR_REMOVING = 'Error removing solution:'

Template.productEditSolutions.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  reactiveTableSettings: function () {
    let solutions = (this.solutions || []).map(function (item) {
      if(item.capabilities){
        item.capabilitiesMapped = item.capabilities.map(function (elem) {
          return elem.name
        }).join('; ');
      }
      return item
    })
    return {
      collection: solutions,
      rowsPerPage: 10,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'name',
          key: 'name',
          label: 'Solution'
        },
        {
          fieldId: 'version',
          key: 'version',
          label: 'Version'
        },
        {
          fieldId: 'capabilitiesMapped',
          key: 'capabilitiesMapped',
          label: 'Capabilities',
          fn: function (value) {
            let list = []
            if(value){
              value.split('; ').forEach(item => {
                list.push(`<span>- ${item}</span>`)
              })
            }
            return value ? new Spacebars.SafeString(list.join('<br/>')) : ''
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'text-right col-actions-fixed',
          tmpl: Template.reactiveTableProductsSolutionsActions
        }
      ]
    };
  }
});

Template.reactiveTableProductsSolutionsActions.events({
  'click .unlink-with' () {
    const approval = this;
    let product = Template.parentData(5);
    let props = {
      approval:{
        _id: approval._id
      },
      product:{
        _id: product._id
      }
    }
    Meteor.callAsync('Products.UnlinkWithRelease', props, null).then(data => {
      if (data === 1) {
        Notify.success('Solution successfully removed');
      } else {
        Notify.danger(ERROR_REMOVING);
      }
    })
  }
})

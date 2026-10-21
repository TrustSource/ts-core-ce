import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

const ERROR_UPDATING = 'Error adding solution:'

Template.productLinkWithRelease.onCreated(function () {
  let loading = new ReactiveVar();
  let details = new ReactiveVar();
  this.details = details;
  this.loading = loading;
});

function fetchData(instance) {
  instance.loading.set(true)
  Meteor.callAsync('getApprovedReleases').then(data => {
    if(data){
      instance.details.set(data)
    }
    instance.loading.set(false)
  })
}

Template.productLinkWithRelease.onRendered(function () {
  const instance = this;
  $('#productLinkWithReleaseModal').off('.productLinkWithRelease')
    .on('show.bs.modal.productLinkWithRelease', function () { fetchData(instance); });
});

Template.productLinkWithRelease.onDestroyed(function () {
  $('#productLinkWithReleaseModal').off('.productLinkWithRelease');
});

Template.productLinkWithRelease.helpers({
  loading: function () {
    const template = Template.instance();
    return template.loading.get()
  },
  reactiveTableSettings: function () {
    let fields = [
      {
        fieldId: 'approved',
        key: 'approved',
        label: 'Approved',
        tmpl: Template.reactiveTableDateCell,
        cellClass: 'col-date',
        sortable: true,
        sortOrder: 0,
        sortDirection: 'descending'
      },
      {
        fieldId: 'name',
        key: 'name',
        label: 'Name'
      },
      {
        fieldId: 'version',
        key: 'version',
        label: 'Version'
      },
      {
        fieldId: 'closedByName',
        key: 'closedByName',
        label: 'Contact'
      },
      {
        fieldId: 'link',
        key: 'link',
        label: '',
        cellClass: 'col-70',
        tmpl: Template.reactiveTableProductsLinkRelease
      }
    ];
    const instance = Template.instance();
    let data = instance.details.get();
    return {
      collection: data || [],
      rowsPerPage: 10,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: fields
    };
  }
});

Template.reactiveTableProductsLinkRelease.events({
  'click .link-with' () {
    const approval = this;
    let product = Template.parentData(5);
    let props = {
      approval:{
        _id: approval._id,
        name: approval.name,
        version: approval.version,
        closedByName: approval.closedByName
      },
      product:{
        _id: product._id,
        name: product.name,
        identifier: product.identifier
      }
    }
    Meteor.callAsync('Products.LinkWithRelease', props, null).then(data => {
      if (data === 1) {
        Notify.success('Solution successfully added');
      } else {
        Notify.danger(ERROR_UPDATING);
      }
    })
  }
})

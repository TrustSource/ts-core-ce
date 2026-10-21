import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Meteor} from 'meteor/meteor';
import Notify from '/imports/api/notify';
import {$} from 'meteor/jquery';

const ERROR_UPDATING = 'Error creating Link:'
const ERROR_REMOVING = 'Error removing Link:'

Template.componentLinkWithRelease.onCreated(function () {
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

Template.componentLinkWithRelease.events({
  'click .link-with-release' () {
    const instance = Template.instance();
    if(instance.data && instance.data.component && instance.details && !instance.details.get()){
      fetchData(instance)
    }
  },
  'click .remove-link-release' () {
    const instance = Template.instance();
    let props = {
      link: this,
      moduleId: instance.data.moduleId
    }
    Meteor.callAsync('componentUnlinkWithRelease', props).then(data => {
      if (data === 1) {
        Notify.success('Link successfully removed');
      } else {
        Notify.danger(ERROR_REMOVING);
      }
    })
  }
})

Template.componentLinkWithRelease.helpers({
  loading: function () {
    const template = Template.instance();
    return template.loading.get()
  },
  hasLink: function () {
    const instance = Template.instance();
    let component = instance.data && instance.data.component;
    let linkedReleases = instance.data && instance.data.linkedReleases;
    if(linkedReleases && component){
      const matched = linkedReleases.find((item)=>{
        return item.key === component.key
      })
      return matched ? matched : false
    }
    return false
  },

  getRouteOptions: function () {
    const data = this;
    let params = {};
    if (data.approve._id) {
      params = {
        approveId: data.approve._id
      };
    }
    return params;
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
        tmpl: Template.reactiveTableScansLinkRelease
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

Template.reactiveTableScansLinkRelease.events({
  'click .link-with' () {
    const approve = this;
    let params = Template.parentData(5);
    let props = {
      approve:{
        _id: approve._id,
        name: approve.name,
        version: approve.version,
        closedByName: approve.closedByName
      },
      moduleId: params.moduleId,
      component: {
        _id: params.component.component._id,
        key: params.component.key,
        versions: params.component.versions
      }
    }
    Meteor.callAsync('componentLinkWithRelease', props).then(data => {
      if (data === 1) {
        Meteor.setTimeout(function () {
          $('#componentLinkWithReleaseModal').modal('hide');
          $('.modal-backdrop.fade').remove();
          $('body').removeClass('modal-open').css({'padding-right': 0});
        }, 1);
        Notify.success('Link successfully created');
      } else {
        Notify.danger(ERROR_UPDATING);
      }
    })
  }
})

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';

Template.capabilitiesList.helpers({
  reactiveTableSettings: function () {
    const data = Template.currentData();
    return {
      collection: data.data,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          fn: function (value, object) {
            return object.name || '_id: ' + object._id;
          }
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description'
        },
        {
          fieldId: 'version',
          key: 'version',
          label: 'Introduced at version',
          cellClass: 'col-state'
        },
        {
          fieldId: 'created',
          key: 'created',
          label: 'Added',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'by'
        },
        {
          fieldId: 'edited',
          key: 'edited',
          label: 'Modified',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'editedBy',
          key: 'editedBy',
          label: 'by'
        },
        {
          fieldId: '_id',
          key: '_id',
          label: '_id',
          hidden: true
        },
        {
          fieldId: 'actions',
          key: 'actions',
          sortable: false,
          label: ' ',
          tmpl: Template.reactiveTableCapabilitiesSettingsActions
        }
      ]
    };
  },
  editId: function () {
    return Session.get('editCapabilitiesDetails')
  },
  editDetails: function () {
    const _id = Session.get('editCapabilitiesDetails')
    const allData = Session.get('getCapabilitiesList')
    if (allData instanceof Array) {
      return _.find(allData, function (elem) {
        return elem._id === _id;
      });
    }
  }
});

Template.reactiveTableCapabilitiesSettingsActions.events({
  'click .edit-capabilities': function (event) {
    event.preventDefault();
    const self = this;
    Session.set('editCapabilitiesDetails',self._id)
    Meteor.setTimeout(function () {
      $('#CapabilitiesEditModal').modal('show');
    },1)
  },
  'click .remove-capabilities': function (event) {
    event.preventDefault();
    const self = this;
    const allData = Session.get('getCapabilitiesList')
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        return elem._id === self._id;
      }) || [];
      Meteor.callAsync('Capabilities.Remove', self._id).then(function() {
        Notify.success('Successfully removed');
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not remove');
      });
      Session.set('getCapabilitiesList', dataWithout);
    }
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';

Template.companyTags.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this,
      rowsPerPage: 15,
      showFilter: true,
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
          label: 'Name'
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description'
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'Creator',
          cellClass: 'col-sender'
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableTagsActions,
          cellClass: 'col-actions'
        }
      ]
    };
  },
  isRemovedList: function (){
    return Router.current().route.getName() === 'companyTagsDeleted'
  }
});

Template.reactiveTableTagsActions.events({
  'click .remove': function (event) {
    event.preventDefault();
    const {name} = this;
    Meteor.callAsync('Tags.Remove', this._id, name).then(function() {
      const message = 'Tag '+name+' removed';
      Notify.success(message);
    }).catch(function(error) {
      const message = 'Internal Error: ' + (error.reason || 'could not remove tag');
      Notify.danger(message);
    })
  },
  'click .reactivate': function (event) {
    event.preventDefault();
    const {name} = this;
    Meteor.callAsync('Tags.Reactivate', this._id, name).then(function() {
      const message = 'Tag '+name+' reactivated';
      Notify.success(message);
    }).catch(function(error) {
      const message = 'Internal Error: ' + (error.reason || 'could not reactivate tag');
      Notify.danger(message);
    })
  }
});

Template.reactiveTableTagsActions.helpers({
  isRemovedList: function (){
    return Router.current().route.getName() === 'companyTagsDeleted'
  }
});

/* global document:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {logEventUserLabel} from '/imports/lib/models/logEvent';


const METHOD = 'LogEvents.ByCompany'

Template.csafDetailsHistory.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.csafDetailsHistory.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.csafDetailsHistory.helpers({
  method: function () {
    return METHOD
  },
  filters: function () {
    return ['companyId', 'company', 'account', 'userName', 'type', 'typeLabel', 'message'];
  },
  sortings: function () {
    return ['date', 'userName', 'typeLabel'];
  },
  options: function () {
    let user = Meteor.user();
    return {
      selector: {companyId: user && user.profile && user.profile.companyId, message:this._id},
      sort: {date: -1}
    };
  },
  fields: function () {
    return [
      {
        fieldId: 'date',
        key: 'date',
        label: 'Date',
        sortable: false,
        cellClass: 'col-date',
        tmpl: Template.reactiveTableDateCell
      },
      {
        fieldId: 'account',
        key: 'account',
        label: 'account',
        sortable: false,
        fn: function (value, object) { return object.account; },
        hidden:true
      },
      {
        fieldId: 'userName',
        key: 'userName',
        label: 'Name',
        sortable: false,
        fn: function (value, object) { return logEventUserLabel(object); }
      },
      {
        fieldId: 'type',
        key: 'type',
        label: 'Type',
        sortable: false,
        fn: function (value, object) { return object.type; },
        hidden:true
      },
      {
        fieldId: 'typeLabel',
        key: 'typeLabel',
        label: 'Type',
        sortable: false,
        fn: function (value, object) {
          return object.typeLabel ? object.typeLabel + ' ('+object.type+')' : object.type;
        }
      }
    ]
  }
});

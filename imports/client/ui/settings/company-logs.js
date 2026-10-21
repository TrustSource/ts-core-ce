/* global moment:false, Papa:false, Blob:false, document:false, window:false */
import {Meteor} from 'meteor/meteor';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';
import {logEventUserLabel} from '/imports/lib/models/logEvent';

const METHOD = 'LogEvents.ByCompany'
const REACTIVE_VAR = 'ReactiveTableServerSideParams'+METHOD

Template.companyLogs.onCreated(function () {
  let clipboard = new Clipboard('.copy-information');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

Template.companyLogs.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.companyLogs.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

function generateEvents (events) {
  if(events){
    return events.list.map(function (event) {
      return {
        'Date': moment(event.date).format('lll'),
        'Name' : event.userName,
        'Type': event.typeLabel ? event.typeLabel + ' ('+event.type+')' : event.type,
        'Action': event.message
      }
    });
  }
  return events
}

Template.companyLogs.events({
  'click .export-csv': function () {
    const {selector, sorting, page, size, fields} = Session.get(REACTIVE_VAR) || {}
    Meteor.callAsync(METHOD, selector, sorting, page, size, fields).then(function(result) {
      let events = generateEvents(result);
      let csvString = Papa.unparse(events,{
        quotes: false,
        quoteChar: '"',
        escapeChar: '"',
        delimiter: ';',
        header: true,
        newline: '\r\n'
      });
      let blob = new Blob([csvString]);
      let fileNameExtension = moment(new Date()).format('YYMMDD-HHmm')+'_'+Utils.username();
      if (window.navigator.msSaveOrOpenBlob)  // IE hack; see http://msdn.microsoft.com/en-us/library/ie/hh779016.aspx
        window.navigator.msSaveBlob(blob, 'export_logs_'+fileNameExtension+'.csv');
      else{
        let a = window.document.createElement('a');
        a.href = window.URL.createObjectURL(blob, {type: 'text/plain'});
        a.download = 'export_logs_'+fileNameExtension+'.csv';
        document.body.appendChild(a);
        a.click();  // IE: "Access is denied";
        // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
        document.body.removeChild(a);
      }
    });
  }
});

Template.companyLogs.helpers({
  getCopyText: function () {
    const {selector, sorting, page, size, fields} = Session.get(REACTIVE_VAR) || {}
    if(size){
      let eventsList = ReactiveMethod.call(METHOD, selector, sorting, page, size, fields);
      let events = generateEvents(eventsList) || []
      return Papa.unparse(events,{
        quotes: false,
        quoteChar: '"',
        escapeChar: '"',
        delimiter: ';',
        header: true,
        newline: '\r\n'
      });
    }
    return ''
  },
  method: function () {
    return METHOD
  },
  filters: function () {
    // Free-text fields go through the basic search bar (regex $or). `type`
    // is exposed via the Advanced filter modal as a dropdown - equality on
    // the enum key is index-friendly, unlike substring regex.
    const types = ReactiveMethod.call('LogEvents.FindTypes');
    const typeOptions = (types && types.list) || [];
    return [
      {key: 'userName', label: 'User name', type: 'text'},
      {key: 'typeLabel', label: 'Event', type: 'text'},
      {key: 'message', label: 'Message', type: 'text'},
      {key: 'type', label: 'Event type', type: 'select', options: typeOptions}
    ];
  },
  sortings: function () {
    return ['date', 'userName', 'typeLabel', 'message'];
  },
  options: function () {
    let user = Meteor.user();
    return {
      selector: {companyId: user && user.profile && user.profile.companyId},
      sort: {date: -1},
      hasAdvanced: true
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
      },
      {
        fieldId: 'message',
        key: 'message',
        label: 'Action',
        sortable: false,
        fn: function (value, object) { return object.message; }
      }
    ]
  }
});

/* global moment:false, Papa:false, Blob:false, document:false, window:false */
import {Meteor} from 'meteor/meteor';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

const METHOD = 'LoginsHistory.ByCompany'

Template.loginsHistory.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.loginsHistory.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});
const REACTIVE_VAR = 'ReactiveTableServerSideParams'+METHOD

Template.loginsHistory.onCreated(function () {
  let clipboard = new Clipboard('.copy-information');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

function generateEvents (events) {
  if(events){
    return events.list.map(function (event) {
      return {
        'Created': moment(event.created).format('YYYY.MM.DD HH:MM'),
        'Allowed' : event.allowed,
        'methodName': event.methodName ? event.methodName + ' ('+event.type+')' : event.type,
        'userEmail': event.userEmail,
        'userName': event.userName
      }
    });
  }
  return events
}

Template.loginsHistory.events({
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
        window.navigator.msSaveBlob(blob, 'export_logins_'+fileNameExtension+'.csv');
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

Template.loginsHistory.helpers({
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
    // Dropped 'allowed' from the regex $or - it's a boolean, regex over
    // 'true'/'false' is meaningless and just adds per-doc work.
    return ['methodName', 'type', 'userEmail', 'userName'];
  },
  sortings: function () {
    return ['created', 'allowed', 'methodName', 'type', 'userEmail', 'userName'];
  },
  options: function () {
    let user = Meteor.user();
    return {
      selector: {companyId: user && user.profile && user.profile.companyId},
      sort: {created: -1}
    };
  },
  fields: function () {
    return [
      {
        fieldId: 'allowed',
        key: 'allowed',
        label: 'Allowed',
        cellClass: 'col-date',
        sortable: false,
        fn: function (value) {
          return (value) ? 'yes' : 'no';
        }
      },
      {
        fieldId: 'created',
        key: 'created',
        label: 'Created',
        sortable: false,
        cellClass: 'col-date',
        tmpl: Template.reactiveTableDateCell
      },
      {
        fieldId: 'methodName',
        key: 'methodName',
        label: 'Method',
        sortable: false,
        cellClass: 'col-date'
      },
      {
        fieldId: 'type',
        key: 'type',
        label: 'Type',
        sortable: false,
        cellClass: 'col-date'
      },
      {
        fieldId: 'userEmail',
        key: 'userEmail',
        sortable: false,
        label: 'Email'
      },
      {
        fieldId: 'userName',
        key: 'userName',
        sortable: false,
        label: 'Name'
      }
    ]
  }
});

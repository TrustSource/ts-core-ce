/* global moment:false, Papa:false, Blob:false, document:false, window:false */
import {Meteor} from 'meteor/meteor';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {Template} from 'meteor/templating';
import Clipboard from 'clipboard';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

const METHOD = 'LoginsHistory.NoLoginsByCompany'

Template.loginsHistoryNoLogins.onCreated(function () {
  let clipboard = new Clipboard('.copy-information');

  clipboard.on('success', function (e) {
    Notify.success('Information was successfully copied');
    e.clearSelection();
  });
});

Template.loginsHistoryNoLogins.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.loginsHistoryNoLogins.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

function generateEvents (events) {
  if(events){
    return events.map(function (event) {
      return {
        'Created': moment(event.created).format('YYYY.MM.DD HH:MM'),
        'userEmail': event.userEmail,
        'userName': event.userName
      }
    });
  }
  return events
}

Template.loginsHistoryNoLogins.events({
  'click .export-csv': function () {
    Meteor.callAsync(METHOD).then(function(result) {
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
        a.download = 'export_users_'+fileNameExtension+'.csv';
        document.body.appendChild(a);
        a.click();  // IE: "Access is denied";
        // see: https://connect.microsoft.com/IE/feedback/details/797361/ie-10-treats-blob-url-as-cross-origin-and-denies-access
        document.body.removeChild(a);
      }
    });
  }
});

Template.loginsHistoryNoLogins.helpers({

  reactiveTableSettings: function () {
    let eventsList = ReactiveMethod.call(METHOD);
    return {
      collection: eventsList || [],
      rowsPerPage: 1000,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortable: false,
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
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
    };
  },
  getCopyText: function () {
    let eventsList = ReactiveMethod.call(METHOD);
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
});

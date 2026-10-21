/* global Papa:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';

const IMPROTS_ID = '#importTags'

Template.companyTagsImport.onCreated( () => {
  Session.set('importResults',false);
});

Template.companyTagsImport.helpers({
  importResults() {
    let response = Session.get('importResults');
    return response && response.result;
  },
  importStats() {
    let response = Session.get('importResults');
    return response && response.stats;
  },
  importExpected() {
    let response = Session.get('importResults');
    return response && response.expected;
  },
  getLineNumber(index) {
    return index+1;
  },
  convertStatus(status) {
    let list = [
      {
        key:'imported',
        label: 'Imported'
      },
      {
        key:'error',
        label: 'Error'
      }
    ];
    let statusItem = _.find(list, function (item) {
      return item.key === status
    });
    return statusItem.label;
  },
  getColClass() {
    let response = Session.get('importResults');
    let stats = Object.keys(response.stats).length;
    if (stats > 4) return 'col-sm-2';
    if (stats === 4) return 'col-sm-3';
    if (stats === 3) return 'col-sm-4';
    return stats === 2 ? 'col-sm-6' : 'col-sm-12'
  }
});

Template.companyTagsImport.events({
  'change [name="uploadCSV"]' ( event) {
    if(event.target.files[0].size/1024/1024 <= 1){
      Papa.parse( event.target.files[0], {
        header: true,
        complete( results ) {
          Meteor.callAsync('Tags.CheckImport', results.data).then(response => {
            Notify.success( 'Import preview updated');
            Session.set('importResults',response);
          });
        }
      });
    }else{
      $(IMPROTS_ID).get(0).reset();
      Notify.danger('Import file type should be *.csv (max: 1mb)');
    }
  },
  'click .clear-import' (event) {
    event.preventDefault();
    Session.set('importResults');
    $(IMPROTS_ID).get(0).reset();
  },
  'click .process-import' (event) {
    event.preventDefault();
    Papa.parse( $('[name="uploadCSV"]')[0].files[0], {
      header: true,
      complete( results ) {
        Meteor.callAsync('Tags.Import', results.data).then(response => {
          const user = Meteor.user();
          let stats = (response.stats.imported?' '+response.stats.imported+' imported':'')+
            (response.stats.errors?' '+response.stats.errors+' errors':'');
          Meteor.callAsync('logEvent', user, 'Tags bulk import performed '+(stats?'('+stats+' )':''), 'tagsImport');
          $(IMPROTS_ID).get(0).reset();
          Notify.success( 'Import complete!');
          Session.set('importResults',response);
        }).catch(error => {
          const user = Meteor.user();
          Meteor.callAsync('logEvent', user, 'Error: '+ (error.reason || 'could not import tags'), 'tagsImport');
        }).finally(() => {
          $('select.select2').select2({width: '100%'});
        });
      }
    });
  },

  'change #importTags input[name=uploadCSV]': function (event) {
    $(event.target).closest('.input-group-file').find('input[name=filename]').val(event.target.files[0] ? event.target.files[0].name : '');
  }
});

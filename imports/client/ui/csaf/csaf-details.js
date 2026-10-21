/* global swal:false, document: false */
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Meteor} from 'meteor/meteor';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import {addToArray, getNestedValue, setNestedValue} from '../../../lib/json';
import {$} from 'meteor/jquery';
import {escapeHtml} from '/imports/lib/html/tableCells';

const ACTIVE_TAB = 'active-tab active '

function validateAndPublishCsaf(dataRoot, csafId, name) {
  Meteor.callAsync('CSAF.Validate', {file: JSON.stringify(dataRoot)}).then(function() {
    Meteor.callAsync('CSAF.Update', {$set: {data: JSON.stringify(dataRoot)}}, csafId).then(function() {
      Meteor.callAsync('tsCsafUpload', csafId, false).then(function() {
        Notify.success('CSAF '+name+' has been published successfully');
      }).catch(function(uploadErr) {
        Notify.danger(uploadErr.toString());
      });
    }).catch(function(updateError) {
      Notify.danger(updateError.message);
    })
  }).catch(function(validateError) {
    Notify.danger(validateError.message);
  })
}

Template.csafDetails.helpers({
  activeTab: function (tab) {
    let state = Router.current().route.getName();
    let view = Session.get('activeView');
    if (view) {
      return view === tab ? ACTIVE_TAB : ''
    } else {
      if (tab instanceof Array) {
        let anyState = _.some(tab, function (obj) {
          return obj === state;
        });
        return anyState ? 'active-tab active' : '';
      } else {
        return tab === state ? ACTIVE_TAB : '';
      }
    }
  },
  isDisabledPublish: function () {
    return this.published
  },
  getRouteOptions: function () {
    let params = {};
    if (Router.current().params.csafId) {
      params = {
        csafId: Router.current().params.csafId
      };
    }
    return params;
  }
});

Template.csafDetails.events({
  'click .csaf_upload': function (event) {
    event.preventDefault();
    const self = this;
    const name = self.publishedFileName || self.name
    swal({
      title: 'Are you sure you want to publish ' + escapeHtml(name) + '? <br/>Summary of the revision:<br/>' +
        '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
      type: 'info',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Yes, publish it!'
    }, function (reason) {
      if(reason === false) return false;
      reason = document.getElementById('confirmationText').value.trim();
      if(reason){
        const now = new Date();
        const newDate = now.toISOString()
        const dataRoot = JSON.parse(self.data);
        const revisions = getNestedValue(dataRoot, 'document.tracking.revision_history');
        if(self.publishedFileName || !revisions.length){
          const newVersion = `${(revisions.length || 0) + 1}`
          addToArray(dataRoot, 'document.tracking.revision_history', {
            date: newDate,
            number: newVersion,
            summary: reason
          })
          setNestedValue(dataRoot, 'document.tracking.current_release_date', newDate);
          setNestedValue(dataRoot, 'document.tracking.version', newVersion);
        }else{
          setNestedValue(dataRoot, 'document.tracking.initial_release_date', newDate);
          setNestedValue(dataRoot, 'document.tracking.current_release_date', newDate);
          setNestedValue(dataRoot, 'document.tracking.revision_history.0.date', newDate);
          setNestedValue(dataRoot, 'document.tracking.revision_history.0.summary', reason);
        }
        validateAndPublishCsaf(dataRoot, self._id, name)
      }else{
        Notify.warn('You are not allowed to publish CSAF without revision summary!');
      }
    });
  },
  'click .csaf_remove': function (event) {
    event.preventDefault();
    const self = this;
    const name = self.publishedFileName || self.name
    Session.set('CSAFRemove', JSON.stringify({
      _id: self._id,
      name: name
    }))
    $('#CSAFRemoveModal').modal('show');
  }
});

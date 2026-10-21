/* global document:false, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';

const NO_REVERT = 'You will not be able to revert this!'
const ACTIVE_TAB = 'active-tab active '

Template.releasesDetails.events({
  'click .approve': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to approve approval ' + self.name + '?',
      text: NO_REVERT,
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, approve it!'
    }, function () {
      Meteor.callAsync('Approves.Approve', self._id).then(function() {
        Meteor.callAsync('logEvent', currUser, 'Approved '+ self.name, 'approveProject');
      }).catch(function(error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
      });
    });
  },
  'click .reject': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to reject approval ' + escapeHtml(self.name) + '? <br>' +
        '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, reject it!'
    }, function (reason) {
      if(reason === false) return false;
      reason = document.getElementById('confirmationText').value;
      if(reason){
        const comment = (reason?reason:'NO REASON PROVIDED');
        Meteor.callAsync('Approves.Reject', self._id, comment).then(function() {
          Meteor.callAsync('logEvent', currUser, 'Rejected ' + self.name + ' / Reason: ' + comment, 'approveProject');
        }).catch(function(error) {
          Notify.danger(error.message);
          Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
        });
      }else{
        Notify.warn('You are not allowed to reject without reason!');
      }
    });
  },
  'click .remove': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to remove draft ' + self.name + '?',
      text: NO_REVERT,
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, remove it!'
    }, function () {
      Meteor.callAsync('Approves.Remove', self._id).then(function() {
        Router.go('approvesList');
      }).catch(function(error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
      });
    });
  },
  'click .create': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to create approval ' + self.name + '?',
      text: NO_REVERT,
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, create it!'
    }, function () {
      Meteor.callAsync('Approves.CreateFromDraft', self._id).then(function(result) {
        Router.go('releasesDetailsOverview', {approveId: result});
      }).catch(function(error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
      });
    });
  }
});

Template.releasesDetails.helpers({
  getApproveDescription: function () {
    return this.description || 'Approval details'
  },
  getApprovePurl: function () {
    return this.purl
  },
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

  getRouteOptions: function () {
    let params = {};
    if (Router.current().params.approveId) {
      params = {
        approveId: Router.current().params.approveId
      };
    }
    return params;
  },

  getReportOptions: function () {
    return {sbomId : this.sbomFileId};
  }
});

/* global swal:false, document: false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Spacebars} from 'meteor/spacebars';
import {moment} from 'meteor/momentjs:moment';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import {addToArray, getNestedValue, setNestedValue} from '/imports/lib/json';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';

const CURRENT_PAGE_VAR = 'csaf-current';

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

Template.csafList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.csafList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.csafList.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

function getList(list) {
  let filteredStates = _.filter(_.map(Session.get('csafFilter') || {}, function (value, key) {
    return value === true ? key : undefined;
  }), function (filter) {
    return filter
  });
  let result = list;
  if (filteredStates.length) {
    Template.instance().currentPage.set(0)
    result = _.filter(result, function (item) {
      return item && _.indexOf(filteredStates, item.status) === -1
    });
  }
  return result;
}

Template.csafList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  reactiveTableSettings: function () {
    return {
      collection: getList(this),
      rowsPerPage: 15,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'submitted',
          key: 'submitted',
          label: 'Created',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell,
          sortable: true,
          sortOrder: 0,
          sortDirection: 'descending'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          fn: function (value, object) {
            // The document name is user input: escaped, since this cell returns markup.
            const reason = escapeHtml(object.publishedFileName || object.name || '')
            return new Spacebars.SafeString(`<span sort="${reason}" title="${reason}">${reason}</span>`);
          },
          cellClass: 'col-200'
        },
        {
          fieldId: 'publishedFileName',
          key: 'publishedFileName',
          label: 'publishedFileName',
          hidden: true
        },
        {
          fieldId: 'statusChanged',
          key: 'statusChanged',
          fn: function (value, object) {
            let date = object.removed ||  object.published ||  object.failed
            let sort = date ?  moment(date).unix() : ''
            let title = date ?  moment(date).format('lll') : ''
            let text = date ?  moment(date).format('ll') : ''
            return new Spacebars.SafeString(`<span sort="${sort}" title="${title}">${text}</span>`);
          },
          cellClass: 'col-date',
          label: 'Status upd.'
        },
        {
          fieldId: 'status',
          key: 'status',
          tmpl: Template.reactiveTableCSAFStatus,
          cellClass: 'col-date',
          label: 'Status'
        },
        {
          fieldId: 'reason',
          key: 'reason',
          fn: function (value, object) {
            // Reasons are typed by users or carry provider error text: escaped.
            const reason = object.published ? '' : escapeHtml(object.removedReason || object.failedReason || '')
            return new Spacebars.SafeString(`<span sort="${reason}" title="${reason}">${reason}</span>`);
          },
          label: 'Reason'
        },
        {
          fieldId: 'failedReason',
          key: 'failedReason',
          label: '',
          hidden: true
        },
        {
          fieldId: 'removedReason',
          key: 'removedReason',
          label: '',
          hidden: true
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'text-right col-actions-fixed',
          tmpl: Template.reactiveTableCSAFActions
        }
      ]
    };
  }
});

Template.csafList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button, .dropdown-menu').length) return;
    if (this._id) {
      Router.go('csafDetailsMeta', {csafId: this._id});
    }
  }
});

Template.reactiveTableCSAFActions.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getOptions: function () {
    return {csafId: this._id}
  },
  getCreateOptions: function () {
    return {query:{csafId: this._id, step: 2}}
  },
  isDraft: function () {
    return this.status !== 'PUBLISHED' && !this.published
  }
});

Template.reactiveTableCSAFActions.events({
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
        Meteor.callAsync('CSAF.FindOne', self._id).then(function(data) {
          const now = new Date();
          const newDate = now.toISOString()
          const dataRoot = JSON.parse(data.data);
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
        }).catch(function(error) {
          Notify.danger(error.message);
        })
      }else{
        Notify.warn('You are not allowed to publish CSAF without revision summary!');
      }
    });
  },
  'click .csaf_delete': function (event) {
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

/* global document:false, swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';
import {Spacebars} from 'meteor/spacebars';
import Pluralize from 'pluralize';

const CURRENT_PAGE_VAR = 'approval-list-current';

Template.approvesList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  $('.panel-body').tooltip({
    selector: '[data-toggle=tooltip]'
  });
  // Move view type select into the reactive table filter row
  const $options = this.$('.reactive-table-options');
  const $viewFilter = this.$('.approves-view-type-filter');
  if ($options.length && $viewFilter.length) {
    $viewFilter.prependTo($options).show();
    $options.addClass('approves-table-filters');
  }
  Session.set('reportProject')
  Session.set('approvesViewType', 'My')
});

Template.approvesList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.approvesList.onCreated(function () {
  Session.set('reportProject')

  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

function getApprovesList(list) {
  let filteredStates = _.map(Session.get('approvesListFilter') || {}, function (value, key) {
    return value === true ? key : undefined;
  });
  let result = list.fetch();
  const viewType = Session.get('approvesViewType')
  if (viewType && viewType !== '') {
    // Template.instance().currentPage.set(0)
    result = _.filter(result, function (item) {
      return (viewType === 'My' && item.assignment === Meteor.userId()) ||
        (viewType === 'Unassigned' && !item.assignment)
    });
  }
  if (filteredStates) {
    // Template.instance().currentPage.set(0)
    result = _.filter(result, function (item) {
      let state = 'open';
      if(item.draft) {
        state = 'draft'
      } else if(item.approved){
        state = 'approved'
      } else if(item.rejected){
        state = 'rejected'
      }
      return item && _.indexOf(filteredStates, state) < 0
    });
  }
  return result;
}

Template.approvesList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  isActiveType: function (view) {
    const viewType = Session.get('approvesViewType') || '';
    return viewType === view;
  },

  reactiveTableSettings: function () {
    let fields = [
      {
        fieldId: 'created',
        key: 'created',
        label: 'Initiated',
        cellClass: 'col-date',
        tmpl: Template.reactiveTableDateCell,
        sortable: true,
        sortOrder: 0,
        sortDirection: 'descending'
      },
      {
        fieldId: 'assignmentName',
        key: 'assignmentName',
        label: 'Assigned to',
        tmpl: Template.reactiveTableApprovesListAssignment
      },
      {
        fieldId: 'projectId',
        key: 'name',
        label: 'Project/Module',
        tmpl: Template.reactiveTableApprovesListProject,
        sortable: true,
        sortFn: function (value, object) {
          if(object.moduleId){
            return (object.projectMeta() && object.projectMeta().name || '')+'/'+(object.moduleMeta() && object.moduleMeta().name || '');
          }else{
            return object.projectMeta().name
          }
        }
      },
      {
        fieldId: 'modules',
        key: 'modules',
        label: 'Modules',
        fn: function (value) {
          return value ? value.length : 0;
        },
        sortable: true
      },
      {
        fieldId: 'name',
        key: 'name',
        label: 'Name'
      },
      {
        fieldId: 'version',
        key: 'version',
        label: 'Version'
      },
      {
        fieldId: 'initiatorName',
        key: 'initiatorName',
        label: 'Initiated by'
      },
      {
        fieldId: 'noticeFileId',
        key: 'noticeFileId',
        label: 'Notice',
        cellClass: 'col-key',
        fn: function (value, object) {
          return object.noticeFileId && object.stats && object.stats.notice ?
            new Spacebars.SafeString('<span sort="' + object.stats.notice.completed + '">' +
              object.stats.notice.completed + '%</span>') : ' ';
        }
      }
    ];
    fields.push({
      fieldId: 'actions',
      key: 'actions',
      label: '',
      sortable: false,
      tmpl: Template.reactiveTableApprovesListActions,
      cellClass: 'col-actions-big'
    });
    return {
      collection: getApprovesList(this),
      rowsPerPage: 15,
      currentPage: Template.instance().currentPage,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: fields
    };
  }

});

Template.approvesList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button, .label-success, .label-danger, .modal').length) return;
    if (this._id) {
      Router.go('approvesDetails', {approveId: this._id});
    }
  },
  'change .view_type': function (event) {
    Session.set('approvesViewType', $(event.target).find(':selected').val());
    const instance = Template.instance();
    if (instance && instance.currentPage) instance.currentPage.set(0);
  }
});

Template.reactiveTableApprovesListAssignment.events({
  'click .add_assignment': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const settings = this;
    Meteor.callAsync(
      'Approves.Update',
      {$set: {assignment: currUser._id, assignmentName: Utils.username()}},
      settings._id
    ).then(function() {
      Meteor.callAsync('logEvent', currUser, 'Approval for ' + settings.name + ' has new assignment ' + settings.assignmentName,
        'approveProject');
    }).catch(function(error) {
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
    });
  },
  'click .remove_assignment': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const settings = this;
    Meteor.callAsync(
      'Approves.Update',
      {$unset: {assignment: true, assignmentName: true}},
      settings._id
    ).then(function() {
      Meteor.callAsync('logEvent', currUser, 'Assignment removed from ' + settings.name + ' approval',
        'approveProject');
    }).catch(function(error) {
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
    });
  }
});

Template.reactiveTableApprovesListActions.events({
  'click .approve': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to approve approval ' + self.name + '?',
      text: 'You will not be able to revert this!',
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
      title: 'You decided to reject the approval.',
      text: 'Please give the project manager a ' +
      'few reasons why you decided to reject his approval, so that he will be able to close the missing bits: <br>' +
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
      text: 'You will not be able to revert this!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, remove it!'
    }, function () {
      Meteor.callAsync('Approves.Remove', self._id).catch(function(error) {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'approveProject');
      });
    });
  }
});

Template.reactiveTableApprovesListActions.helpers({
  getOptions: function () {
    return {approveId: this._id}
  }
});

Template.reactiveTableApprovesListProject.helpers({
  getPluralizeModules: function () {
    return Pluralize('modules', this.modules.length, true)
  },
  getModuleLabel: function () {
    const project = this.projectObj || (typeof this.projectMeta === 'function' && this.projectMeta()) || (typeof this.project === 'function' && this.project())
    const module = this.moduleObj || (typeof this.moduleMeta === 'function' && this.moduleMeta()) || (typeof this.module === 'function' && this.module())
    return (project ? project.name : '') + ' / ' + (module ? module.name : '')
  },
  getProjectLabel: function () {
    const project = this.projectObj || (typeof this.projectMeta === 'function' && this.projectMeta()) || (typeof this.project === 'function' && this.project())
    return project && project.name
  },
  getModuleOptions: function () {
    return {projectId: this.projectId, moduleId: this.moduleId}
  },
  getProjectOptions: function () {
    return {projectId: this.projectId}
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

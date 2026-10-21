/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {moment} from 'meteor/momentjs:moment';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import {$} from 'meteor/jquery';
import NoticeFiles from '/imports/lib/collections/noticeFiles';

import Notify from '/imports/api/notify';
import {Session} from 'meteor/session';

const TAG_SPAN = '<span sort="'

Template.reportNoticeFiles.onCreated(function () {
  this.subsReady = new ReactiveVar(false);
  const self = this;
  const handle = Meteor.subscribe('NoticeFiles');
  this.autorun(function () {
    if (handle.ready()) {
      self.subsReady.set(true);
    }
  });
});

Template.reportNoticeFiles.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.reportNoticeFiles.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.reportNoticeFiles.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  subsReady: function () {
    return Template.instance().subsReady.get();
  },

  reactiveTableSettings: function () {
    const data = NoticeFiles.find().fetch();
    return {
      collection: data,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
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
          fieldId: 'disabledStatus',
          key: 'disabledStatus',
          label: 'Frozen',
          sortable: false,
          fn: function (value, object) {
            if(object.disabled){
              return new Spacebars.SafeString('<span title="'+moment(object.disabled).format('lll')+'" ' +
                'class="fa fa-snowflake-o"></span>');
            }
          }
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Project/Module',
          fn: function (value, object) {
            const mod = object.moduleId && object.module();
            const proj = object.projectId && object.project();
            if (object.moduleId) {
              const modName = escapeHtml(mod && mod.name || 'N/A');
              const projPrefix = proj ? (escapeHtml(proj.name) + ' / ') : '';
              return new Spacebars.SafeString(TAG_SPAN + projPrefix + modName + '">' +
                projPrefix + modName + '</span>');
            }
            const projName = escapeHtml(proj && proj.name || '');
            return new Spacebars.SafeString(TAG_SPAN + projName + '">' + projName + '</span>');
          }
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            return object.components || 0;
          }
        },
        {
          fieldId: 'projectName',
          key: 'projectId',
          hidden: true,
          fn: function (value, object) {
            return object.projectId ? (object.project() && object.project().name) : '';
          }
        },
        {
          fieldId: 'moduleName',
          key: 'moduleId',
          hidden: true,
          fn: function (value, object) {
            const mod = object.moduleId && object.module();
            return mod ? mod.name : '';
          }
        },
        {
          fieldId: 'version',
          key: 'version',
          label: 'Version'
        },
        {
          fieldId: 'edited',
          key: 'edited',
          label: 'Edited',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'By',
          fn: function (value, object) {
            const userName = escapeHtml(object.userName || 'unknown');
            return object.userName ? new Spacebars.SafeString(TAG_SPAN + userName + '">' + userName + '</span>') : '';
          }
        },
        {
          fieldId: 'completed',
          key: 'complete',
          label: 'Complete',
          fn: function (value, object) {
            const completed = escapeHtml(object.completed);
            return new Spacebars.SafeString(TAG_SPAN + completed + '">' + completed + '%</span>');
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableNoticeFilesActions,
          cellClass: 'col-actions'
        }
      ]
    };
  },

  writtenOffer: function () {
    const company = Session.get('company');
    return company && company.writtenOffer
  }
});

Template.reportNoticeFiles.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('noticeFileDetails', {noticeId: this._id});
    }
  }
});

function getName(report) {
  return report.moduleId ? report.module() && report.module().name || 'Module is N.A.'
    : (report.project() && report.project().name) || 'Project is N.A.';
}

Template.reactiveTableNoticeFilesActions.events({
  'click .delete-notice-file': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const self = this;
    let logName = getName(self);
    swal({
      title: 'Are you sure you want to delete notice file for ' + logName + '?',
      text: 'You will not be able to recover this notice file!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('NoticeFiles.Remove', self._id).then(function() {
        Meteor.callAsync('logEvent', user, 'Notice file '+logName+' has been deleted', 'noticeFileDeleted');
        Notify.success('Notice file '+logName+' has been deleted');
        Router.go('reportNoticeFiles');
      }).catch(function(err) {
        let textError = 'Error: ' + (err || ' could not delete notice file');
        Meteor.callAsync('logEvent', user, textError, 'noticeFileDeleted');
        Notify.danger(textError);
      });
    });
  }
});
Template.reactiveTableNoticeFilesActions.helpers({
  getOptions: function () {
    return {noticeId: this._id}
  },
  isFrozen: function () {
    return this.disabled
  }
});

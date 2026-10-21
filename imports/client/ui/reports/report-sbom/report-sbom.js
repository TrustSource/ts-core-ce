/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {moment} from 'meteor/momentjs:moment';
import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import {$} from 'meteor/jquery';
import SbomFiles from '/imports/lib/collections/sbomFiles';

import Notify from '/imports/api/notify';

const TAG_SPAN = '<span sort="'

Template.reportSbomFiles.onCreated(function () {
  this.subsReady = new ReactiveVar(false);
  const self = this;
  const handle = Meteor.subscribe('SbomFiles');
  this.autorun(function () {
    if (handle.ready()) {
      self.subsReady.set(true);
    }
  });
});

Template.reportSbomFiles.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.reportSbomFiles.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.reportSbomFiles.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  subsReady: function () {
    return Template.instance().subsReady.get();
  },

  reactiveTableSettings: function () {
    const data = SbomFiles.find().fetch();
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
            const projectName = escapeHtml((object.project() && object.project().name) || '');
            const moduleName = escapeHtml((object.module() && object.module().name) || '');
            const projectPrefix = object.projectId && projectName ? (projectName + ' / ') : '';
            const moduleHtml = new Spacebars.SafeString(TAG_SPAN + projectPrefix + moduleName + '">' +
                projectPrefix + moduleName + '</span>');
            const projectHtml = new Spacebars.SafeString(TAG_SPAN + projectName + '">' + projectName + '</span>');
            return object.moduleId ? moduleHtml : projectHtml;
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
            return object.moduleId ? (object.module() && object.module().name) : '';
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
          tmpl: Template.reactiveTableSbomFilesActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reportSbomFiles.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('sbomFileDetails', {sbomId: this._id});
    }
  }
});

function getName(report) {
  return report.moduleId ? (report.module() && report.module().name) || 'Module is N.A.'
    : (report.project() && report.project().name) || 'Project is N.A.';
}

Template.reactiveTableSbomFilesActions.events({
  'click .delete-sbom-file': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const self = this;
    let logName = getName(self);
    swal({
      title: 'Are you sure you want to delete SBOM file for ' + logName + '?',
      text: 'You will not be able to recover this SBOM file!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('SbomFiles.Remove', self._id).then(function() {
        Meteor.callAsync('logEvent', user, 'SBOM file '+logName+' has been deleted', 'sbomFileDeleted');
        Notify.success('SBOM file '+logName+' has been deleted');
        Router.go('reportSbomFiles');
      }).catch(function(err) {
        let textError = 'Error: ' + (err || ' could not delete SBOM file');
        Meteor.callAsync('logEvent', user, textError, 'sbomFileDeleted');
        Notify.danger(textError);
      });
    });
  }
});
Template.reactiveTableSbomFilesActions.helpers({
  getOptions: function () {
    return {sbomId: this._id}
  },
  isFrozen: function () {
    return this.disabled
  }
});

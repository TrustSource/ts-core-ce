import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import TestTools from '/imports/lib/collections/testTools';

const CURRENT_PAGE_VAR = 'tests-current';

Template.testsList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('getToolsSettings',TestTools.find().fetch() || []);
});

Template.testsList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.testsList.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

function getList(list) {
  let filteredStates = _.filter(_.map(Session.get('testsFilter') || {}, function (value, key) {
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

Template.testsList.helpers({
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
          label: 'Submitted',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell,
          sortable: true,
          sortOrder: 0,
          sortDirection: 'descending'
        },
        {
          fieldId: 'type',
          key: 'type',
          label: 'Type',
          cellClass: 'col-type'
        },
        {
          fieldId: 'status',
          key: 'status',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableModuleTestsStatus,
          label: 'Status'
        },
        {
          fieldId: 'tool',
          key: 'tool',
          label: 'Tool',
          tmpl: Template.reactiveTableModuleTestsTool,
          cellClass: 'col-tool'
        },
        {
          fieldId: 'statusDetails',
          key: 'statusDetails',
          label: 'Details',
          tmpl: Template.reactiveTableModuleTestsStatusDetails
        },
        {
          fieldId: 'cwes',
          key: 'cwes',
          label: 'CWEs',
          sortable: false,
          tmpl: Template.reactiveTableModuleTestsCwes
        },
        {
          fieldId: 'projectId',
          key: 'projectId',
          label: 'Project',
          tmpl: Template.reactiveTableModuleTestsProject,
          sortable: false,
          cellClass: 'col-tool'
        },
        {
          fieldId: 'moduleId',
          key: 'moduleId',
          label: 'Module',
          tmpl: Template.reactiveTableModuleTestsModule,
          cellClass: 'col-tool'
        },
        {
          fieldId: 'scanId',
          key: 'scanId',
          label: 'Scan',
          tmpl: Template.reactiveTableModuleTestsScan,
          cellClass: 'col-date'
        },
        {
          fieldId: 'analysisId',
          key: 'analysisId',
          label: 'Analysis',
          tmpl: Template.reactiveTableModuleTestsAnalysis,
          cellClass: 'col-date'
        }
      ]
    };
  }
});

Template.testsList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('testsDetails', {testId: this._id});
    }
  }
});

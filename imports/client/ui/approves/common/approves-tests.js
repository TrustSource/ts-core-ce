import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import _ from 'underscore';
import {ReactiveVar} from 'meteor/reactive-var';
import {$} from 'meteor/jquery';
import ApprovalReports from '/imports/lib/collections/approvalReports';
import TestTools from '/imports/lib/collections/testTools';
import Utils from '/imports/lib/utils';

function getModuleIds(approval) {
  return _.map(approval.modules,function (module) {
    return module._id
  });
}

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

const CURRENT_PAGE_VAR = 'tests-current';

Template.approvesTests.onCreated(function () {
  let currentPage = new ReactiveVar(Session.get(CURRENT_PAGE_VAR) || 0);
  this.currentPage = currentPage;
  this.autorun(function () {
    Session.set(CURRENT_PAGE_VAR, currentPage.get());
  });
});

Template.approvesTests.onRendered(function () {
  Session.set('getToolsSettings',TestTools.find().fetch() || []);
});

Template.approvesTests.helpers({
  getTests: function () {
    const approve = this;
    Session.set('requestInProgress', true);
    Session.set('reportTests');
    let getList = ApprovalReports.findOne({type:'tests',approveId:approve._id});
    Session.set('reportTests', getList && getList.data);
    Session.set('requestInProgress', false);
    if(getList){
      return getList.data.list
    }else{
      let {projectId, companyId, modules} = approve
      const moduleIds = getModuleIds(approve)
      let getList = ReactiveMethod.call('getProjectTests', projectId, companyId, moduleIds, modules);
      Session.set('reportTests', getList);
      Session.set('requestInProgress', false);
      if(getList){
        return getList.list
      }else{
        return []
      }
    }
  },
  reactiveTableSettings: function () {
    let list = Session.get('reportTests')
    return {
      collection: getList(list && list.list || list),
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
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          cellClass: 'text-right col-actions-small',
          tmpl: Template.reactiveTableTestsActions
        }
      ]
    };
  },
  getStats: function () {
    let reportTests = Session.get('reportTests')
    return reportTests.moduleStats
  },
  getModuleStats: function (moduleId) {
    let reportTests = Session.get('reportTests')
    let tools = reportTests && reportTests.moduleStats && reportTests.moduleStats[moduleId].tools
    let stats = {
      ok: 0,
      warnings: 0,
      violations: 0,
      total: 0
    }
    return Utils.extendQualityStats(stats, tools)
  },
  getModuleInfo: function (moduleId) {
    let reportTests = Session.get('reportTests')
    return reportTests.modules.find(function (module) {
      return module._id === moduleId
    })
  },
  objectToArray(obj) {
    return Object.keys(obj).map((key) => {
      return { key, value: obj[key] };
    });
  },
  getTool: function (name) {
    let list = Session.get('getToolsSettings');
    let toolData = list && list.find(item => {
      return item.name.toLowerCase() === name.toLowerCase();
    })
    if(toolData){
      return toolData
    }else{
      return {
        name
      }
    }
  },
  getToolStats: function (value){
    let {ok, warnings, violations} = value
    if(!ok){
      ok = 0
    }
    if(!warnings){
      warnings = 0
    }
    if(!violations){
      violations = 0
    }
    let total = ok + warnings + violations;
    let okPercent = ok && total ? (ok * 100) / total : 0;
    let warningsPercent = warnings && total ? (warnings * 100) / total : 0;
    let violationsPercent = violations && total ? (violations * 100) / total : 0;
    return {ok, okPercent, warnings, warningsPercent, violations, violationsPercent, total}
  }
});

Template.approvesTests.events({
  'click .collapse-action': function (event) {
    const action = $(event.target).closest('.collapse-action');
    $(action).next('.panel-body').toggleClass('hidden');
  }
});

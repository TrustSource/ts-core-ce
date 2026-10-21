import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import _ from 'underscore';
import Tests from '/imports/lib/collections/tests';
import TestTools from '/imports/lib/collections/testTools';
import Projects from '/imports/lib/collections/projects';
import {$} from 'meteor/jquery';
import {getFindingsSummary} from '/imports/lib/sarif/runStatus';
import {applyMappings} from '/imports/lib/sarif/cweMappingOverlay';
import {cweMappingIndex} from '/imports/client/ui/helpers/cwe-mappings';
import {cweBadgeRows, countLabel, emptyCweCellState} from '/imports/client/ui/helpers/test-findings';

const CURRENT_PAGE_VAR = 'tests-current';

Template.moduleTests.onRendered(function () {
  Session.set('getToolsSettings',TestTools.find().fetch() || []);
  Session.set('currentComponent');
});

Template.moduleTests.onCreated(function () {
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

Template.moduleTests.helpers({
  hasTestsStats: function () {
    const module = Template.parentData()
    return module && module.quality && module.quality.tools
  },
  testsStats: function () {
    const module = Template.parentData()
    return Object.keys(module.quality.tools).map((key) => {
      return { key, value: module.quality.tools[key] };
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
  },
  reactiveTableSettings: function () {
    let list = Tests.find({'moduleId': Router.current().params.moduleId}).fetch()
    return {
      collection: getList(list),
      rowsPerPage: 10,
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
// Details cell for the tests tables (module, /tests and approves all render it).
//
// Leads with the findings the run actually reported and demotes `rules.total` to a
// labelled aside: it is the tool's declared rule catalog, which for
// `semgrep --config auto` is the whole loaded registry rather than the rules applied
// to the scanned files. SARIF carries no count of the latter.
Template.reactiveTableModuleTestsStatusDetails.helpers({
  testFindings: function () {
    if (!this.rules) {
      return null;
    }
    const findings = getFindingsSummary(this.rules);
    return {
      total: findings.total,
      findingsLabel: findings.total === 1 ? 'finding' : 'findings',
      violations: findings.violations,
      warnings: findings.warnings,
      notes: findings.notes,
      // How many distinct rules fired per severity - the numbers the cell used to
      // print without saying what they counted.
      violationRules: this.rules.violations || 0,
      warningRules: this.rules.warnings || 0,
      noteRules: this.rules.notes || 0,
      catalogSize: this.rules.total || 0
    };
  }
});

// The document's weaknesses, busiest first. Only the first few fit
// a table cell, so the rest collapse into a "+N" whose tooltip names them - the
// full breakdown is on the document's own page.
const CWES_IN_CELL = 3;

Template.reactiveTableModuleTestsCwes.helpers({
  testCwes: function () {
    return rankedCwes(this).slice(0, CWES_IN_CELL);
  },
  moreCwes: function () {
    return Math.max(0, rankedCwes(this).length - CWES_IN_CELL);
  },
  moreCwesTitle: function () {
    const rest = rankedCwes(this).slice(CWES_IN_CELL);
    return countLabel(rest.length, 'more weakness', 'more weaknesses') + ': ' +
      rest.map(function (entry) { return entry.cwe; }).join(', ');
  },
  // An empty cell means one of two different things and a bare "-" said neither:
  // rules.byCwe was added later and was not back-filled, so a document
  // imported before it records no weaknesses at all - while its own details page
  // still derives them from the stored run. Re-parsing every stored run to fill
  // a paginated column is not worth its cost; saying which empty this is, is.
  emptyCwes: function () {
    return emptyCweCellState(!!(this.rules && this.rules.byCwe));
  }
});

// Weaknesses the tool published, plus any a Security Manager assigned to a rule
// it left unclassified. The assignment is overlaid over the stored
// per-rule counts rather than written into byCwe, so it shows here on documents
// imported long before anyone assigned it.
function rankedCwes(doc) {
  const rules = doc && doc.rules;
  return cweBadgeRows(applyMappings(rules && rules.byCwe, rules && rules.byRule,
    cweMappingIndex(), doc && doc.tool));
}

Template.moduleTests.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('testsDetails', {testId: this._id});
    }
  }
});

Template.reactiveTableModuleTestsTool.helpers({
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
  }
});
Template.reactiveTableModuleTestsProject.helpers({
  getOptions: function () {
    const moduleId = this.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    if(module){
      return {
        projectId: module.projectId || Projects.UNASSIGNED
      }
    }else {
      return {
        projectId: Projects.UNASSIGNED
      }
    }
  },
  projectName: function () {
    if (this.projectName) {
      return this.projectName;
    }
    const moduleId = this.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    if(module){
      const project =  Projects.findOne(module.projectId);
      return project && project.name
    }else {
      return ''
    }
  }
});
Template.reactiveTableModuleTestsModule.helpers({
  getOptions: function () {
    const moduleId = this.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    if(module){
      return {
        projectId: module.projectId || Projects.UNASSIGNED,
        moduleId: moduleId
      }
    }else {
      return {
        projectId: Projects.UNASSIGNED,
        moduleId: moduleId
      }
    }
  },
  moduleName: function () {
    if (this.moduleName) {
      return this.moduleName;
    }
    const moduleId = this.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    if(module){
      return module.name
    }else {
      return moduleId
    }
  }
});
Template.reactiveTableModuleTestsScan.helpers({
  getOptions: function () {
    return {_id: this.scanId}
  }
});
Template.reactiveTableModuleTestsAnalysis.helpers({
  getOptions: function () {
    const moduleId = this.moduleId;
    let modules = Session.get('modulesByProject');
    let module = modules && modules.find((module)=>{
      return module._id === moduleId
    });
    if(module){
      return {
        projectId: module.projectId || Projects.UNASSIGNED,
        moduleId: moduleId
      }
    }else {
      return {
        projectId: Projects.UNASSIGNED,
        moduleId: moduleId
      }
    }
  },
  getQuery: function () {
    return {
      analysis: this.analysisId
    }
  }
});

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import {resolveRuleForResult, resolveResultSeverity, collectRules} from '/imports/lib/sarif/runStatus';
import {buildFindingSummary, findingLocations, resolveResultMessage} from '/imports/lib/sarif/findingSummary';
import {extractRuleCwes, collectRunCwes} from '/imports/lib/sarif/cweExtract';
import {applyMappings, collectRunRuleCounts, mappedCwesForRule, mappedEntryForRule}
  from '/imports/lib/sarif/cweMappingOverlay';
import {cweMappingIndex, canAssignCwe} from '/imports/client/ui/helpers/cwe-mappings';
import {
  cweBadgeRows, countLabel, findingStatusClass, findingStatusTitle, groupResultsByFile,
  groupResultsByRule, mergeGroupCwes, unclassifiedRuleIds
} from '/imports/client/ui/helpers/test-findings';

// The SARIF run stored on the test document. Parsed here rather than read back
// through Template.parentData(): inside an event handler Blaze resolves parent
// data contexts from the template's own view, so parentData(1) hands back the
// test document (tool name "semgrep" as a plain string) and parentData(2) is
// null - which is why every created issue was titled "[Test] ..." and no
// project repository was ever found.
function parseRun(testDoc) {
  if (!testDoc || !testDoc.data) {
    return null;
  }
  try {
    return JSON.parse(testDoc.data);
  } catch (err) {
    console.error('testsDetails: stored SARIF run is not valid JSON', err);
    return null;
  }
}

function runDriver(run) {
  return (run && run.tool && run.tool.driver) || null;
}

function toolNameOf(run, testDoc) {
  const driver = runDriver(run);
  return (driver && driver.name) ||
    (testDoc && typeof testDoc.tool === 'string' && testDoc.tool) || 'Test';
}

// Driver plus extensions: CodeQL declares its queries in an extension and leaves
// driver.rules empty, so reading the driver alone left every finding on this page
// unresolved - red status icon, "FAILED" message, no help link and no CWE.
function rulesOf(run) {
  const rules = collectRules(run);
  return rules.length ? rules : null;
}

// The name a CWE mapping is filed under: the driver's own name, which is also
// what the import stores on the document. Deliberately not
// toolNameOf's "Test" display fallback - an assignment filed under a placeholder
// would match nothing and mislead whoever made it.
function mappingTool(testDoc, run) {
  const driver = runDriver(run);
  return (driver && driver.name) || (testDoc && testDoc.tool) || '';
}

// Every weakness the document reports, busiest first: what the tool published
// plus what anyone here assigned to a rule it left unclassified.
// The badge itself is derived by the shared helper, so this page and the tests
// tables cannot disagree about which weaknesses count as somebody's assignment.
function documentCweRows(run, testDoc) {
  return cweBadgeRows(applyMappings(collectRunCwes(run), collectRunRuleCounts(run),
    cweMappingIndex(), mappingTool(testDoc, run)));
}

// Rules that fired and that neither the tool nor anyone here has classified
// - what the header counts and what the Assign CWE action exists
// for. Distinct rule ids, in the order they first fired.
function unclassifiedRuleIdsForRun(run, testDoc) {
  const rules = rulesOf(run);
  const tool = mappingTool(testDoc, run);
  const index = cweMappingIndex();
  return unclassifiedRuleIds(
    (run && run.results) || [],
    function (result) {
      const severity = resolveResultSeverity(result, rules);
      return severity && severity.ruleId;
    },
    function (result, ruleId) {
      return extractRuleCwes(resolveRuleForResult(result, rules)).length > 0 ||
        mappedCwesForRule(index, tool, ruleId).length > 0;
    });
}

// The weaknesses behind one group of findings. Driven off the group's results,
// so it works unchanged for By File - where the group key is a path and its
// findings come from several different rules.
//
// Each rule is read once: its weaknesses are a property of the rule, not of the
// finding, so a group of 500 findings from one rule used to run the same tag
// extraction 500 times and merge 500 identical entries. A Set rather than an
// object, for the same reason the shared helper's maps have a null prototype.
function groupCweBadges(group, testDoc) {
  const rules = Session.get('testSettingRules');
  // The stored driver name, so a group does not re-parse the run to learn it.
  const tool = mappingTool(testDoc, null);
  const index = cweMappingIndex();
  const seenRules = new Set();
  const entries = [];
  ((group && group.list) || []).forEach(function (result) {
    const severity = resolveResultSeverity(result, rules);
    if (!severity || seenRules.has(severity.ruleId)) {
      return;
    }
    seenRules.add(severity.ruleId);
    extractRuleCwes(resolveRuleForResult(result, rules)).forEach(function (cwe) {
      entries.push({cwe: cwe, assigned: false});
    });
    mappedCwesForRule(index, tool, severity.ruleId).forEach(function (cwe) {
      entries.push({cwe: cwe, assigned: true});
    });
  });
  return mergeGroupCwes(entries);
}

// The assignment behind a group, if it has one. Only a By Rule group can: a By
// File group is keyed by a path and its findings come from several rules at
// once, so there is no single rule to file an assignment under.
function assignedEntryForGroup(group, testDoc) {
  if (!group || group.isFileGroup || !group.ruleId) {
    return null;
  }
  return mappedEntryForRule(cweMappingIndex(), mappingTool(testDoc, null), group.ruleId);
}

let _issueContext = null;
let _riskPrefill = null;
let _cweAssignment = null;

function testCreateIssueSubmitHandler(form) {
  const modalTitle = $(form).find('[name=modalTitle]').val();
  const modalDescription = $(form).find('[name=modalDescription]').val();
  const ctx = _issueContext;
  if (!ctx || !ctx.repository) {
    Notify.warn('Repo url is not found in company / project / module settings');
    return;
  }
  Meteor.callAsync(
    'tsGithubCreateIssue',
    ctx.projectId,
    ctx.repository,
    modalTitle,
    modalDescription
  ).then(function (result) {
    if (result.data && !result.response) {
      Notify.success('Issue was successfully created');
    } else {
      if (result && result.status === 401) {
        Notify.danger('The request has not been applied because it lacks valid authentication credentials. Please check your GitHub issues authorization.');
      } else if (result && result.response && result.response.data) {
        Notify.danger(result.response.data.message);
      } else {
        Notify.danger('Internal error. Please contact support');
      }
    }
  }).catch(function (err) {
    Notify.danger(err.message || 'Internal error');
  }).finally(function () {
    Meteor.setTimeout(function () {
      $('#testCreateIssueModal').modal('hide');
    }, 200);
  });
}

Template.testsDetails.onCreated(function () {
  this.groupByMode = new ReactiveVar('rule');
  // The /tests/:testId route subscribes to the document only, so the module ->
  // project -> repository lookup behind "Create issue" has nothing to read.
  // Same call the other pages that need the flat module list make.
  if (!Session.get('modulesByProject')) {
    Meteor.callAsync('modulesByProject', false, true).then(function (data) {
      Session.set('modulesByProject', data);
    }).catch(function () {
      // repository then falls back to the company-level GitHub settings
    });
  }
});

Template.testsDetails.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.testsDetails.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.testsDetails.helpers({
  testData: function () {
    const test = Template.currentData()
    const testData = parseRun(test)
    if (!testData) return null
    Session.set('testSettingRules', rulesOf(testData) || undefined)
    return testData
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
  // The severity square beside a finding. Resolved through the same reader the
  // counters use and then mapped by the shared helper, so the icons cannot
  // contradict the header again: they used to fall back to a red 'FAILED' for a
  // severity nobody stated, while the counting layer counted the very same
  // finding as a warning - which is what SARIF says an unstated severity means.
  getTestStatus: function (result) {
    return findingStatusClass(result, resolveResultSeverity(result, Session.get('testSettingRules')));
  },
  // ...and what the square means, since grey ("the counters do not count this
  // one") is not self-explanatory.
  getTestStatusTitle: function (result) {
    return findingStatusTitle(result, resolveResultSeverity(result, Session.get('testSettingRules')));
  },
  getTestMessage: function (result) {
    // Shared resolver so the text shown here is the text a created issue/risk
    // carries. It also survives a rule that declares messageStrings while the
    // result carries no `arguments`, which used to throw.
    return resolveResultMessage(result, Session.get('testSettingRules')) || 'FAILED'
  },
  getRule: function (ruleId) {
    const rules = Session.get('testSettingRules')
    if(rules){
      return rules.find(item => {return item.id === ruleId})
    }
    return {
      id: ruleId,
      ruleId: ruleId
    }
  },
  isGroupByRule: function () {
    return Template.instance().groupByMode.get() === 'rule';
  },
  isGroupByFile: function () {
    return Template.instance().groupByMode.get() === 'file';
  },
  isFileGroupItem: function () {
    return Template.instance().groupByMode.get() === 'file';
  },
  // The finding row is driven by the location list, so a result carrying no
  // `locations` - legal SARIF - used to render nothing at all: the group header
  // counted it and the panel body stayed blank.
  findingLocations: function () {
    return findingLocations(this);
  },
  // Both groupings run through the shared helper, whose maps have a null
  // prototype: a rule id - or, far more plausibly, a source path - of
  // `__proto__` wrote through to Object.prototype instead of into the map, and
  // its whole group disappeared from the list.
  resultsGrouped: function () {
    return Template.instance().groupByMode.get() === 'file' ?
      groupResultsByFile(this.results, findingLocations) :
      groupResultsByRule(this.results);
  },
  defaultPanelClass: function (listLength) {
    return listLength > 10 ? 'hidden' : ''
  },
  defaultHeadingClass: function (listLength) {
    return listLength > 10 ? 'collapsed' : ''
  },
  // Every weakness this document reports, busiest first. Read from
  // the stored run rather than from rules.byCwe, so documents imported before
  // that field existed show their CWEs here too. Weaknesses a Security Manager
  // assigned to rules the tool left unclassified are overlaid on top.
  documentCwes: function () {
    return documentCweRows(this, Template.instance().data);
  },
  // Rules that fired and that nobody has classified - the ones the Assign CWE
  // action exists for. Counted in the header so it is visible without expanding
  // every group.
  unclassifiedRuleCount: function () {
    return unclassifiedRuleIdsForRun(this, Template.instance().data).length;
  },
  unclassifiedRuleLabel: function () {
    return countLabel(unclassifiedRuleIdsForRun(this, Template.instance().data).length,
      'rule', 'rules') + ' unclassified';
  },
  // The strip is worth drawing for either half: weaknesses to show, or rules
  // waiting to be given one.
  hasCweSummary: function () {
    return documentCweRows(this, Template.instance().data).length > 0 ||
      unclassifiedRuleIdsForRun(this, Template.instance().data).length > 0;
  },
  // An assigned weakness is marked as such: it is a human's claim, not something
  // the tool reported.
  groupCwes: function () {
    return groupCweBadges(this, Template.instance().data);
  },
  // Whether this rule already carries an assignment - which is what decides
  // between Edit and Assign, and what the modal is seeded from. It used to be
  // decided by groupCwes, which also contains what the TOOL published: on a rule
  // the tool had classified the action read "Edit CWEs" and then opened an empty
  // dialog, and saving there filed a second, unrelated assignment.
  hasAssignedGroupCwe: function () {
    return !!assignedEntryForGroup(this, Template.instance().data);
  },
  // Assigning is the answer to "the tool classified nothing here", which is the
  // scope the feature shipped with: on a rule the tool did classify, an
  // assignment can only add a weakness beside the tool's own - it cannot correct
  // one - so offering it there invites a change it will not make. An assignment
  // that does exist stays editable and withdrawable wherever it is, including on
  // a rule that has since gained a classification from the tool.
  canAssignGroupCwe: function () {
    if (this.isFileGroup || !canAssignCwe()) {
      return false;
    }
    const testDoc = Template.instance().data;
    if (assignedEntryForGroup(this, testDoc)) {
      return true;
    }
    return !groupCweBadges(this, testDoc).some(function (badge) {
      return !badge.assigned;
    });
  },
  canCreateRisk: function () {
    const user = Meteor.user();
    return user && Roles.userIsInRole(user, ['compliance_manager', 'manager'], user.profile.companyId);
  }
});

Template.testsDetails.events({
  'click .group-toggle-btn': function (event) {
    const mode = $(event.currentTarget).data('mode');
    Template.instance().groupByMode.set(mode);
  },
  'click .test-create-issue': function (event) {
    event.preventDefault();
    const group = this;
    const test = Template.instance().data;
    const run = parseRun(test);
    const description = buildFindingSummary(group, {
      toolName: toolNameOf(run, test),
      rules: rulesOf(run)
    });

    // Resolve projectId and repository
    let projectId = null;
    let repository = null;
    if (test && test.moduleId) {
      const modules = Session.get('modulesByProject');
      const module = modules && modules.find(function (m) { return m._id === test.moduleId; });
      if (module && module.projectId) {
        projectId = module.projectId;
        const project = Projects.findOne(module.projectId);
        if (project && project.repository) repository = project.repository;
      }
    }
    if (!repository) {
      const company = Session.get('company');
      repository = company && company.github && company.github.active ? company.github.repository : null;
    }

    _issueContext = {projectId: projectId, repository: repository};

    let modal = $('#testCreateIssueModal');
    modal.find('[name=modalTitle]').val(description.title);
    modal.find('[name=modalDescription]').val(description.text);
    modal.modal('show');
    modal.off('shown.bs.modal.issueInit').on('shown.bs.modal.issueInit', function () {
      let form = $('#testCreateIssueForm');
      if (form.length) {
        form.validate({
          submitHandler: testCreateIssueSubmitHandler
        });
      }
    });
  },
  'click .test-create-risk': function (event) {
    event.preventDefault();
    const group = this;
    const test = Template.instance().data;
    const run = parseRun(test);
    const summary = buildFindingSummary(group, {
      toolName: toolNameOf(run, test),
      rules: rulesOf(run)
    });

    // Risk name is capped at 200 characters by RiskSchema
    _riskPrefill = {
      name: summary.title.substring(0, 200),
      description: summary.text,
      // The weaknesses the tool named, straight into the risk's own CWE field
      // rather than only into its prose.
      cwes: summary.cwes || []
    };
    $('#RiskAddModal').modal('show');
  },
  'click .test-assign-cwe': function (event) {
    event.preventDefault();
    const test = Template.instance().data;
    const tool = mappingTool(test, null);
    // In By Rule mode the group key is the rule id. `this` is the group itself -
    // resolving it through parentData() would hand back the wrong context
    // (see parseRun above for the same trap on the issue/risk actions).
    const existing = mappedEntryForRule(cweMappingIndex(), tool, this.ruleId);
    _cweAssignment = {tool: tool, ruleId: this.ruleId, cwes: existing ? existing.cwes : []};

    const modal = $('#assignCweModal');
    modal.modal('show');
    modal.off('shown.bs.modal.cweInit').on('shown.bs.modal.cweInit', function () {
      modal.find('#assignCweRuleId').text(_cweAssignment.ruleId);
      modal.find('#assignCweTool').text('(' + _cweAssignment.tool + ')');
      const select = modal.find('[name=assignCwes]');
      if (select.hasClass('select2-hidden-accessible')) {
        select.select2('destroy');
      }
      // Tags mode: a value only takes if a matching <option> exists, and the
      // markup renders none - so the current assignment is appended before it
      // can be selected, the same dance the risk modal does with tmCwes.
      select.empty();
      const cwes = (_cweAssignment && _cweAssignment.cwes) || [];
      cwes.forEach(function (cwe) {
        select.append($('<option></option>').attr('value', cwe).text(cwe));
      });
      select.select2({
        tags: true,
        width: '100%',
        placeholder: 'CWE-79',
        tokenSeparators: [',', ' ']
      });
      select.val(cwes).trigger('change');
      // Title and Withdraw button read the same fact, so the dialog cannot say
      // "Assign" while offering to withdraw what is already assigned.
      modal.find('#assignCweModalTitle').text(cwes.length ?
        'Edit the CWEs assigned to this rule' : 'Assign CWEs to this rule');
      $('#assignCweRemove').toggleClass('hidden', !cwes.length);
      const form = $('#assignCweForm');
      if (form.length) {
        form.validate({submitHandler: assignCweSubmitHandler});
      }
    });
  },
  'click .collapse-action': function (event) {
    if ($(event.target).closest('.test-finding-actions').length) return;
    // A CWE badge in the heading is a link out to MITRE; following it should not
    // also collapse the group behind it.
    if ($(event.target).closest('.test-cwe-badge').length) return;
    if(!($(event.target).hasClass('help-url') ||
      $(event.target).hasClass('fa-external-link') ||
      $(event.target).hasClass('group-toggle-btn'))) {
      const action = $(event.target).closest('.collapse-action');
      $(action).toggleClass('collapsed');
      $(action).next('.panel-body').toggleClass('hidden');
    }
  }
});

$(document).on('hidden.bs.modal', '#testCreateIssueModal', function () {
  _issueContext = null;
});

$(document).on('shown.bs.modal', '#RiskAddModal', function () {
  if (_riskPrefill) {
    let modal = $('#RiskAddModal');
    modal.find('[name=addRisk]').val(_riskPrefill.name);
    modal.find('[name=impactDescription]').val(_riskPrefill.description);
    modal.find('[name=state]').val('identified').trigger('change');
    const cwes = _riskPrefill.cwes || [];
    Meteor.setTimeout(function () {
      modal.find('[name=origin]').val(['SQ']).trigger('change');
      // tmCwes is a select2 in tags mode: a value only takes if a matching
      // <option> exists, and riskThreatModelFields renders options solely for an
      // existing risk's CWEs. Append what is missing, then select the lot. The
      // component's own dedupe pass keeps a re-open from doubling them.
      if (cwes.length) {
        const select = modal.find('[name=tmCwes]');
        cwes.forEach(function (cwe) {
          if (!select.find('option[value="' + cwe + '"]').length) {
            select.append($('<option></option>').attr('value', cwe).text(cwe));
          }
        });
        select.val(cwes).trigger('change');
      }
    }, 150);
    _riskPrefill = null;
  }
});

$(document).on('hidden.bs.modal', '#RiskAddModal', function () {
  _riskPrefill = null;
});

// Assign CWE. Nothing is written into the stored document: the
// mapping is company-wide and overlaid wherever weaknesses are read, so the
// badge appears here - and on every other document using the same rule -
// through the reactive publication, without a reload.
function assignCweSubmitHandler(form) {
  const context = _cweAssignment;
  if (!context) {
    return;
  }
  const value = $(form).find('[name=assignCwes]').val() || [];
  Meteor.callAsync('CweMappings.Set', {
    tool: context.tool,
    ruleId: context.ruleId,
    cwes: Array.isArray(value) ? value : [value]
  }).then(function () {
    Notify.success('CWE assignment saved');
    $('#assignCweModal').modal('hide');
  }).catch(function (error) {
    // The select is `multiple`, so "the CWE" was wrong as often as it was right.
    Notify.danger((error && error.reason) || 'Could not save the CWE assignment');
  });
}

// The modal is moved to <body> when it opens, so its own content is bound here
// rather than through Template.events, which would never fire.
$(document).on('click', '#assignCweRemove', function (event) {
  event.preventDefault();
  const context = _cweAssignment;
  if (!context) {
    return;
  }
  Meteor.callAsync('CweMappings.Remove', {tool: context.tool, ruleId: context.ruleId})
    .then(function () {
      Notify.success('Assignment withdrawn');
      $('#assignCweModal').modal('hide');
    }).catch(function (error) {
      Notify.danger((error && error.reason) || 'Could not withdraw the assignment');
    });
});

$(document).on('hidden.bs.modal', '#assignCweModal', function () {
  _cweAssignment = null;
});

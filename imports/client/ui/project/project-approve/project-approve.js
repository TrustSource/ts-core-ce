import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Spacebars} from 'meteor/spacebars';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {moment} from 'meteor/momentjs:moment';
import Notify from '/imports/api/notify';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Approve from '/imports/lib/project/Approve';
import Module from '/imports/lib/project/Module';

const STATE_ICONS = {ok: 'fa-check-circle', warnings: 'fa-exclamation-triangle', violations: 'fa-times-circle'};

function renderState(value, object) {
  let state = value;
  if (object.getStatistics) {
    state = object.getStatistics(approve.getModuleAnalysis(object._id)).getState();
  }
  const icon = STATE_ICONS[state] || 'fa-question-circle';
  return new Spacebars.SafeString('<span class="label label-fw bg-' + state + '" sort=' + state + ' title="' + state + '">' +
    '<span class="fa ' + icon + '"></span></span>');
}

let approve = new Approve();

Template.projectApprove.onRendered(function () {
  Session.set('approveStep',1);
  Session.set('approveLoading', false);
  // Each step swaps its content into the same scroll container, so advancing used to keep
  // the previous step's offset and drop the user into the middle of the next table, with
  // the step indicator and heading scrolled out of view. Deferred so the new step has
  // rendered before we scroll.
  this.autorun(function () {
    Session.get('approveStep');
    Meteor.setTimeout(function () {
      const content = document.querySelector('.content-area');
      if (content) content.scrollTop = 0;
    }, 0);
  });
});

Template.projectApprove.onCreated(function () {
  approve.reset(Router.current().params.projectId, Router.current().params.moduleId, Router.current().params.query.draft);
});

function filteredModules(projectId, type) {
  let filteredStates = _.map(Session.get('moduleFilter') || {}, function (value, key) {
    return value === true ? key : undefined;
  });
  let filterList = Session.get('moduleListFilter') || '';

  const query = {};

  if (projectId === Projects.UNASSIGNED) {
    query.projectId = {$exists: false};
  } else if (projectId) {
    query.projectId = projectId;
  }

  let result = [];
  Modules.find(query, {sort: {name: -1}}).forEach(p => {
    p.analysisId = approve.getModuleAnalysis(p._id);
    p.analysisObj = p.getAnalysis(approve.getModuleAnalysis(null, p.analysisId));
    const statistics = p.getStatistics(approve.getModuleAnalysis(p._id));
    const state = statistics && statistics.getState();
    if ((!state) || p &&
      _.indexOf(filteredStates, state) < 0 && p.name.toLowerCase().indexOf(filterList.toLowerCase()) > -1) {
      if(p.properties && p.properties.architecture === 'infrastructureModule'){
        let template =  _.find(Session.get('infrastructureTemplates'),function (item) {
          return item.key === 'im:' + p.moduleIdentifier
        });
        p.crawlerInfo = template && template.crawlerInfo
      }
      if(p.moduleIdentifier && p.moduleIdentifier.indexOf('im:') === -1){
        result.push(p);
      }
    }
  });
  if(type === 'selected'){
    result = _.filter(result, function (module) {
      return approve.isSelectedModule(module._id)
    });
  }
  let sorting = Session.get('moduleListSorting');
  _.sortBy(result, function (item) {
    return item.name;
  });
  if (sorting) {
    result = result.reverse();
  }
  result = _.map(result, function (m) {
    return new Module(m)
  });
  return result;
}

function processStep1(projectId) {
  if(approve.getName()){
    const modules = filteredModules(projectId);
    _.each(modules, function (module) {
      approve.selectModule(module._id, module.version)
    });
  }
}

Template.projectApprove.events({
  'submit #createApproveForm': function (event) {
    event.preventDefault();
    const current = Session.get('approveStep');
    const projectId = this._id;
    switch (current) {
    case 1 :
      processStep1(projectId);
      Session.set('approveStep',current + 1);
      break;
    case 2 :
      Session.set('approveStep',current + 1);
      break;
    case 3 :
      Session.set('approveStep',current + 1);
      break;
    case 4 :
      Session.set('approveLoading', true);
      Meteor.callAsync('Approves.Create', {...approve.getData(), background: true}).then(function(data) {
        Session.set('approveLoading', false);
        Router.go('projectApproveFinalize', {approveId: data, projectId: Router.current().params.projectId});
      }).catch(function(error) {
        const user = Meteor.user();
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+error.message, 'approveCreate');
        Session.set('approveLoading', false);
      });
      break;
    default :
      Session.set('approveStep',current + 1);
      break;
    }
  },
  'click .go_prev': function () {
    const current = Session.get('approveStep');
    Session.set('approveStep',current - 1)
  },
  'input [name=approve_name]': function (event) {
    const approve_name = $(event.target).val();
    approve.setName(approve_name);
  },
  'input [name=approve_version]': function (event) {
    const approve_version = $(event.target).val();
    approve.setVersion(approve_version);
  },
  'input [name=approve_description]': function (event) {
    const approve_description = $(event.target).val();
    approve.setDescription(approve_description);
  },
  'input [name=approve_purl]': function (event) {
    const approve_purl = $(event.target).val();
    approve.setPurl(approve_purl);
  },
  'input [name=approve_draft]': function (event) {
    const content = $(event.target).closest('.form-group');
    const isChecked = content.find('input[name=approve_draft]:checked')
    const approve_draft = !!isChecked.length;
    approve.setDraft(approve_draft);
  },
  'click .go_to_step': function (event) {
    const targetStep = $(event.target).attr('data-step');
    if(targetStep < Session.get('approveStep')){
      Session.set('approveStep',+targetStep);
    }
  }
});

Template.projectApprove.helpers({

  approveData: function () {
    return approve
  },

  isLoading: function () {
    return Session.get('approveLoading');
  },

  isCurrentApproveStep: function (step) {
    return Session.get('approveStep') === step
  },

  isCurrentApproveStepClass: function (step) {
    return Session.get('approveStep') >= step ? 'active' : ''
  },

  isCurrentApproveStepIconClass: function (step) {
    return Session.get('approveStep') >= step ? 'badge-primary' : ''
  },

  canGoPrev: function () {
    return Session.get('approveStep') > 1 && Session.get('approveStep') < 5
  },

  canGoNext: function () {
    return Session.get('approveStep') < 5
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  isUnassignedProject: function (project) {
    project = project || this;
    return project && project._id === Projects.UNASSIGNED;
  },

  hasModules: function () {
    const res = filteredModules(this._id);
    return res && res.length > 0;
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  getRelease: function () {
    let release = _.sortBy(_.filter(this.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse();
    return release[0]
  },

  reactiveTableStep2: function () {
    return {
      collection: filteredModules(this._id),
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'select',
          key: 'select',
          label: 'Select',
          tmpl: Template.reactiveTableStep2Checkbox,
          sortable: false,
          cellClass: 'col-marked'
        },
        {
          fieldId: 'state',
          key: 'state',
          label: 'State',
          fn: renderState,
          cellClass: 'col-state'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesNameTargetBlank
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            return object.getStatistics && object.getStatistics(approve.getModuleAnalysis(object._id)).components ?
              object.getStatistics(approve.getModuleAnalysis(object._id)).components : '';
          }
        },
        {
          fieldId: 'legal',
          key: 'legal',
          label: 'Legal',
          tmpl: Template.reactiveTableLegalStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'vulnerabilities',
          key: 'vulnerabilities',
          label: 'Security',
          tmpl: Template.reactiveTableVulnerabilityStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'quality',
          key: 'quality',
          label: 'Quality',
          tmpl: Template.reactiveTableQualityStats,
          sortable: false,
          cellClass: 'col-180'
        }
      ]
    };
  },

  reactiveTableStep3: function () {
    return {
      collection: filteredModules(this._id, 'selected'),
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'state',
          key: 'state',
          label: 'State',
          fn: renderState,
          cellClass: 'col-state'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesNameTargetBlank
        },
        {
          fieldId: 'analysis',
          key: 'analysis',
          label: 'Analysis',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesAnalysis,
          cellClass: 'col-url'
        }
      ]
    };
  },

  reactiveTableStep4: function () {
    return {
      collection: filteredModules(this._id, 'selected'),
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'state',
          key: 'state',
          label: 'State',
          fn: renderState,
          cellClass: 'col-state'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesNameTargetBlank
        },
        {
          fieldId: 'analysisId',
          key: 'analysisId',
          label: 'Analysis',
          fn: function (value, object) {
            let module = approve.getModule(object._id);
            if(module){
              let list = [];
              if(module.date){
                list.push('<span class="fa fa-clock-o inner-r-5" title="Date"></span><span>'+
                  moment(module.date).format('lll')+'</span>')
              }
              if(module.branch){
                list.push('<span class="fa fa-code-fork inner-r-5" title="Branch"></span><span>'+module.branch+'</span>')
              }
              if(module.tag){
                list.push('<span class="fa fa-tag inner-r-5" title="Tag"></span><span>'+module.tag+'</span>')
              }
              if (module.version) {
                list.push('Version: <span>' + module.version + '</span>')
              }
              if (module.release) {
                list.push('<span class="fa fa-snowflake-o inner-r-5" title="Analysis tag"></span><span>' + module.release + '</span>')
              }
              return new Spacebars.SafeString(list.join('<span class="inner-r-10"></span>'));
            }
            return '';
          }
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            return object.getStatistics && object.getStatistics(approve.getModuleAnalysis(object._id)).components ?
              object.getStatistics(approve.getModuleAnalysis(object._id)).components : '';
          }
        },
        {
          fieldId: 'legal',
          key: 'legal',
          label: 'Legal',
          tmpl: Template.reactiveTableLegalStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'vulnerabilities',
          key: 'vulnerabilities',
          label: 'Security',
          tmpl: Template.reactiveTableVulnerabilityStats,
          sortable: false,
          cellClass: 'col-180'
        },
        {
          fieldId: 'quality',
          key: 'quality',
          label: 'Quality',
          tmpl: Template.reactiveTableQualityStats,
          sortable: false,
          cellClass: 'col-180'
        }
      ]
    };
  }
});


Template.reactiveTableStep2Checkbox.events({
  'input [name=select_module]': function (event) {
    const moduleId = $(event.target).val();
    approve.toggleModule(moduleId);
  }
});

Template.reactiveTableStep2Checkbox.helpers({
  isSelectedModule: function () {
    return approve.isSelectedModule(this._id);
  }
});

function updateAnalysisMeta(moduleId, analysisList) {
  let branches = _.unique(_.map(_.filter(analysisList, function (analysis) {
    return analysis.branch
  }), function (analysis) {
    return analysis.branch
  }));
  let tags = _.unique(_.map(_.filter(analysisList, function (analysis) {
    return analysis.tag
  }), function (analysis) {
    return analysis.tag
  }));
  Session.set('moduleAnalysisBranches'+moduleId, branches);
  Session.set('moduleAnalysisTags'+moduleId, tags);
}

function getCurrentAnalysisList(moduleId) {
  let list = Session.get('moduleAnalysis'+moduleId);
  updateAnalysisMeta(moduleId, list);
  let currentFilter = Session.get('viewAnalysisFilterValue'+moduleId);
  if (currentFilter) {
    let filterType = currentFilter.substr(0, currentFilter.indexOf('##'));
    let filterValue = currentFilter.substr(currentFilter.indexOf('##') + 2);
    list = list.filter(function (item) {
      if (filterType === 'branch') {
        return item.branch === filterValue
      } else if (filterType === 'tag') {
        return item.tag === filterValue
      }
    })
  }
  if(list && list[0] && !approve.getModuleAnalysis(moduleId)){
    approve.setModuleAnalysis(moduleId, list[0]);
  }
  return list
}
// open tab if selected by hash
Template.reactiveTableModulesAnalysis.onRendered(function () {
  const moduleId = this.data && this.data._id;
  Session.set('viewAnalysisFilter'+moduleId);
  Session.set('viewAnalysisFilterValue'+moduleId);

});

Template.reactiveTableModulesAnalysis.events({
  'click .view-analysis-filter': function (event) {
    const moduleId = this._id;
    Session.set('viewAnalysisFilter'+moduleId, !Session.get('viewAnalysisFilter'+moduleId));
    Meteor.setTimeout(function () {
      if (Session.get('viewAnalysisFilter'+moduleId)) {
        let filter = $(event.target).parents('.module_analysis').find('.change_filter');
        filter.select2({
          placeholder: 'Find by branch or tag',
          allowClear: true,
          width: '100%'
        }).on('change.select2', function () {
          Meteor.setTimeout(function () {
            Session.set('viewAnalysisFilter'+moduleId, false);
          }, 1)
        });
        filter.select2('open');
      }
    }, 1)
  },
  'change .change_filter': function (event) {
    const moduleId = this._id;
    const filter = $(event.target).find(':selected').val();
    Session.set('viewAnalysisFilterValue'+moduleId, filter);
    Meteor.setTimeout(function () {
      const analysisId = $(event.target).parents('.module_analysis').find('.module_analysis_list').find(':selected').val();
      let list = Session.get('moduleAnalysis'+moduleId);
      let analysis = _.find(list, function (item) {
        return item._id === analysisId
      });
      approve.setModuleAnalysis(moduleId, analysis);
    },1)
  },
  'change .module_analysis_list': function (event) {
    const moduleId = this._id;
    const analysisId = $(event.target).find(':selected').val();
    let list = Session.get('moduleAnalysis'+moduleId);
    let analysis = _.find(list, function (item) {
      return item._id === analysisId
    });
    approve.setModuleAnalysis(moduleId, analysis);
  }
});

Template.reactiveTableModulesAnalysis.helpers({
  moduleAnalysis: function () {
    const moduleId = this._id;
    Meteor.callAsync('getModuleAnalysis', moduleId).then(function(result) {
      Session.set('moduleAnalysis'+moduleId, result);
    }).catch(function(error) {
      console.log(error);
      Session.set('moduleAnalysis'+moduleId);
    });
    return getCurrentAnalysisList(moduleId);
  },

  viewAnalysisFilter: function () {
    const moduleId = this._id;
    return Session.get('viewAnalysisFilter'+moduleId);
  },

  moduleAnalysisBranches: function () {
    const moduleId = this._id;
    return Session.get('moduleAnalysisBranches'+moduleId);
  },

  moduleAnalysisTags: function () {
    const moduleId = this._id;
    return Session.get('moduleAnalysisTags'+moduleId);
  },

  isCurrentAnalysis: function (_id) {
    let module = Template.parentData();
    if (module && module.analysisId) {
      let currentId = module.analysisId;
      return currentId === _id
    }
  },

  isCurrentAnalysisFilter: function (_id) {
    const moduleId = this._id;
    let currentFilter = Session.get('viewAnalysisFilterValue'+moduleId);
    if (currentFilter) {
      currentFilter = currentFilter.substr(currentFilter.indexOf('##') + 2);
      return _id === currentFilter
    } else {
      return false
    }
  },

  getCurrentAnalysisFilterValue: function () {
    const moduleId = this._id;
    let currentFilter = Session.get('viewAnalysisFilterValue'+moduleId);
    if (currentFilter) {
      return currentFilter.substr(currentFilter.indexOf('##') + 2);
    } else {
      return false
    }
  },

  getCurrentAnalysisFilterType: function () {
    const moduleId = this._id;
    let currentFilter = Session.get('viewAnalysisFilterValue'+moduleId);
    if (currentFilter) {
      let filterType = currentFilter.substr(0, currentFilter.indexOf('##'));
      if (filterType === 'branch') {
        return 'fa-code-fork'
      } else if (filterType === 'tag') {
        return 'fa-tag'
      }
    } else {
      return ''
    }
  },

  isInfrastructureModule: function () {
    return (this && this.properties &&
      (this.properties.architecture === 'infrastructureModule' ||
      this.properties.architecture === 'infrastructureTemplate')) ||
      (this && this.properties &&
      (this.properties.architecture === 'cotsModule' ||
      this.properties.architecture === 'cotsTemplate'))
  }
});

Template.reactiveTableModulesNameTargetBlank.helpers({
  getModuleOptions: function () {
    return {
      projectId: this.projectId || Projects.UNASSIGNED,
      moduleId: this.moduleId || this._id
    };
  },

  getModuleQuery: function () {
    if(this.analysisId){
      return {
        analysis: this.analysisId || null
      };
    }else{
      return {};
    }
  }
});

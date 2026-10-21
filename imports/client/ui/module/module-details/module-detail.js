/* global window:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Tracker} from 'meteor/tracker';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {startGuideTour} from '/imports/client/ui/common/guide/guide-panel';
import RLocalStorage from 'meteor/simply:reactive-local-storage'
import Projects from '/imports/lib/collections/projects';
import {Roles} from 'meteor/alanning:roles';
import moment from 'moment';
import Notify from '/imports/api/notify';
import {initScrollableTabs, destroyScrollableTabs} from '/imports/client/ui/common/scrollable-tabs';

const ACTIVE_TAB = 'active-tab active '

function startIntro() {
  if (startGuideTour('dependency')) {
    saveIntro();
  }
}

function saveIntro() {
  RLocalStorage.setItem('dependencyIntro', true);
  const user = Meteor.user();
  if (user) {
    let intro = user.intro || {}
    intro.dependency = true
    Meteor.callAsync('updateUserIntro', 'dependency', true).catch(function (error) {
      console.log('User intro.dependency save problem: ' + error);
    });
  }
}

function updateAnalysisMeta(analysisList) {
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
  Session.set('moduleAnalysisBranches', branches);
  Session.set('moduleAnalysisTags', tags);
}

function updateAnalysis(reload, analysis) {
  Meteor.callAsync('getModuleAnalysis', Router.current().params.moduleId).then(function(result) {
    Session.set('moduleAnalysis', result);
    updateAnalysisMeta(result);
    if (reload && result && result.length) {
      let analysisItem = {};
      if (analysis) {
        analysisItem = _.find(result, function (item) {
          return item._id === analysis
        });
        if(analysisItem){
          Session.set('newRelease', analysisItem.release);
        }
      }
      let query = Router.current().params.query || {};
      query.analysis = analysisItem && analysisItem._id || result[0]._id;
      Session.set('newRelease');
      Session.set('newCreatedNoticeFileId');
      Router.go(Router.current().route.getName(), {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      }, {
        query: query
      });
    }
  }).catch(function(error) {
    console.log(error);
    Session.set('moduleAnalysis');
  });
}

// open tab if selected by hash
Template.moduleDetail.onRendered(function () {
  initScrollableTabs(this);

  $(function () {
    const hash = window.location.hash;
    hash && $('ul.nav a[href="' + hash + '"]').tab('show');
  });

  $('[data-toggle="tooltip"]').tooltip({placement: 'left'});

  Session.set('viewAnalysisFilter');
  Session.set('viewAnalysisFilterValue');
  Session.set('newRelease');
  updateAnalysis();

  // The analysis worker writes the analysis and the module's `statistics.analysisId`
  // straight to the database, so an analysis this page did not start itself (the demo
  // project's deferred processScan, a scan import, a CI upload) only shows up here as a
  // change to the module document. The tabs load their components once per route, and
  // the analysis list once per render, so without this a module's FIRST analysis stayed
  // at "No data found" until a reload. Follow the pointer the same way the Analyse button
  // does: re-read the list and move `?analysis=` to the new one, which reruns every tab.
  // A page pinned to an older analysis by a deep link is left where it is.
  let lastModuleId;
  let lastAnalysisId;
  this.autorun(function () {
    const module = Template.currentData();
    if (!module || !module._id) return;
    const analysisId = (module.statistics && module.statistics.analysisId) || null;
    if (module._id !== lastModuleId) {
      lastModuleId = module._id;
      lastAnalysisId = analysisId;
      return;
    }
    if (analysisId === lastAnalysisId) return;
    const previous = lastAnalysisId;
    lastAnalysisId = analysisId;
    Tracker.nonreactive(function () {
      const pinned = Router.current().params.query.analysis;
      // Already showing it: the Analyse / Update stats handlers reload the list and
      // move `?analysis=` themselves when their call returns, and doing it again here
      // would fetch the list and rerun every tab a second time.
      if (analysisId && pinned === analysisId) return;
      updateAnalysis(!!analysisId && (!pinned || pinned === previous), analysisId);
    });
  });

  const user = Meteor.user();
  if (!RLocalStorage.getItem('dependencyIntro') && user && (!user.intro || !user.intro.dependency)){
    startIntro();
  }

});

Template.moduleDetail.onDestroyed(function () {
  destroyScrollableTabs(this);
});

Template.moduleDetail.events({
  'click .show-intro': function (event) {
    event.preventDefault();
    startIntro();
  },
  'click .module-settings': function () {
    const projectId = this.projectId || Projects.UNASSIGNED;
    Router.go('moduleSettings', {moduleId: this._id, projectId: projectId});
  },
  'click .module-analyze': function () {
    Notify.success('Analysis started');
    Meteor.callAsync('analyzeModule', this._id).then(function() {
      Notify.success('Module was successfully analyzed.');
      updateAnalysis(true)
    }).catch(function(error) {
      Notify.danger('Analysis error: '+ (error.reason));
    })
  },
  'click .module-update-stats': function () {
    Notify.success('Analysis started');
    Meteor.callAsync('Modules.AnalyzeWithoutScan', this._id).then(function() {
      Notify.success('Module was successfully analyzed.');
      updateAnalysis(true)
    }).catch(function(error) {
      Notify.danger('Analysis error: '+ (error.reason));
    })
  },
  'click a[data-toggle]': function (event) {
    const tab = $(event.target).attr('href');
    let showFilter = false;

    if (tab === '#moduleComponents') {
      const filter = Session.get('moduleDetailFilter');
      if (filter && filter.licenseName) {
        showFilter = true;
      }
    }
    if (showFilter) {
      $('li#comp-lic-filter').show();
    } else {
      $('li#comp-lic-filter').hide();
    }

    /* adjust browser location bar, and prevent jumping to center panel, if possible (pushState available)*/
    if (window.history.pushState) {
      window.history.pushState(null, null, tab);
    } else {
      window.location.hash = tab;
    }
  },
  'click .change-analysis-item': function (event) {
    event.preventDefault();
    const analysis = $(event.currentTarget).data('analysis');
    updateAnalysis(true, analysis);
  },
  'click .set-active-view': function (event) {
    const view = $(event.target).attr('data-view') || $(event.target).parent().attr('data-view');
    Session.set('activeView', view);
    Session.set('moduleDetailListSorting');
    Session.set('moduleDetailListFilter');
    Session.set('moduleDetailFilter');
  },
  'click .reset-active-view': function () {
    Session.set('activeView');
  },
  'click .view-analysis-filter': function (event) {
    event.preventDefault();
    Session.set('viewAnalysisFilter', !Session.get('viewAnalysisFilter'));
    Meteor.setTimeout(function () {
      if (Session.get('viewAnalysisFilter')) {
        let filter = $('#changeFilter');
        filter.select2({
          placeholder: 'Find by branch or tag',
          allowClear: true,
          width: '100%'
        }).on('change.select2', function () {
          Meteor.setTimeout(function () {
            Session.set('viewAnalysisFilter', false);
          }, 1)
        }).on('select2:close', function () {
          Meteor.setTimeout(function () {
            Session.set('viewAnalysisFilter', false);
          }, 150)
        });
        filter.select2('open');
      }
    }, 1)
  },
  'change #changeFilter': function () {
    Session.set('viewAnalysisFilterValue', $('#changeFilter').find(':selected').val());
    let list = getCurrentAnalysisList();
    if (list) {
      let analysis = list[0];
      let query = Router.current().params.query || {};
      query.analysis = analysis._id;
      Router.go(Router.current().route.getName(), {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      }, {
        query: query
      });
      Session.set('viewAnalysisFilter', false);
    }
  },
  'click .clear-analysis-filter': function (event) {
    event.preventDefault();
    Session.set('viewAnalysisFilterValue');
    Session.set('viewAnalysisFilter', false);
    updateAnalysis(true);
  }
});

function isAnalysisInProgress(module) {
  return module.status && !!module.status.match(/in progress/);
}

function getCurrentAnalysisList() {
  let list = Session.get('moduleAnalysis');
  let currentFilter = Session.get('viewAnalysisFilterValue');
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
  return list
}

Template.moduleDetail.helpers({

  hasError: function () {
    return this.error
  },

  hasFilters: function (componentsTab) {
    const filter = Session.get('moduleDetailFilter');
    return filter && (filter.ok || filter.warnings || filter.violations || componentsTab && filter.licenseName);
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

  settingsWarningClass: function () {
    return this.settingsValid() ? '' : 'module-settings-warning';
  },
  settingsWarningTitle: function () {
    return this.settingsValid() ? '' : 'Please complete module settings (legal & architecture)';
  },

  analyseButtonDisabledAttr: function () {
    return isAnalysisInProgress(this) ? 'disabled' : ''
  },
  analyseButtonText: function () {
    return isAnalysisInProgress(this) ? 'Analysis in progress' : 'Analyse'
  },

  getModuleOptions: function () {
    let params = {};
    if (Router.current().params.projectId) {
      params = {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      };
    }
    return params;
  },

  getVulnReportOptions: function () {
    let params = {};
    if (Router.current().params.projectId) {
      params = {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      };
      let analysis = Router.current().params.query.analysis ||
        this.analysis && ((this.analysis[0] && this.analysis[0]._id) || this.analysis._id)
      if(analysis){
        params.analysis = analysis
      }
    }
    return params;
  },

  getModuleQuery: function () {
    if (Router.current().params.query.analysis) {
      return {
        analysis: Router.current().params.query.analysis
      }
    }
  },

  isUnassignedProject: function () {
    return Router.current().params.projectId === Projects.UNASSIGNED;
  },

  getArchitectureType: function (type) {
    if (type) {
      const types = [
        {label: 'Frontend-UI-Module', value: 'FEU'},
        {label: 'Frontend-Endpoint', value: 'FEE'},
        {label: 'Frontend-Service', value: 'FES'},
        {label: 'Backend-Service', value: 'BES'},
        {label: 'Backend-Endpoint', value: 'BEE'},
        {label: 'System component', value: 'SC'},
        {label: 'Infrastructure Service', value: 'IS'},
        {label: 'Distributable Component', value: 'DC'}
      ];
      let item = _.find(types, function (item) {
        return item.value === type
      });
      return item.label;
    }
  },

  isInfrastructureModule: function () {
    return (Template.currentData() && Template.currentData().properties &&
      (Template.currentData().properties.architecture === 'infrastructureModule' ||
      Template.currentData().properties.architecture === 'infrastructureTemplate')) ||
      (Template.currentData() && Template.currentData().properties &&
      (Template.currentData().properties.architecture === 'cotsModule' ||
      Template.currentData().properties.architecture === 'cotsTemplate'))
  },

  isInfrastructureTemplate: function () {
    return (Template.currentData() && Template.currentData().properties &&
    (Template.currentData().properties.architecture === 'infrastructureModule' ||
    Template.currentData().properties.architecture === 'infrastructureTemplate'))
  },

  getManagerEmail: function () {
    let user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) return '';
    const users = Meteor.users.find({}, {sort: {'profile.name': 1}}).fetch();
    const admin = _.find(users, function (item) {
      return Roles.userIsInRole(item, ['manager'], companyId);
    });
    if (admin && admin.profile) {
      return admin.profile.email
    } else {
      return ''
    }
  },

  getManagerName: function () {
    let user = Meteor.user();
    const companyId = user && user.profile && user.profile.companyId;
    if (!companyId) return 'your company admin';
    const users = Meteor.users.find({}, {sort: {'profile.name': 1}}).fetch();
    const admin = _.find(users, function (item) {
      return Roles.userIsInRole(item, ['manager'], companyId);
    });
    if (admin && admin.profile) {
      return admin.profile.name
    } else {
      return 'your company admin'
    }
  },

  moduleAnalysis: function () {
    return getCurrentAnalysisList();
  },

  moduleAnalysisBranches: function () {
    return Session.get('moduleAnalysisBranches');
  },

  moduleAnalysisTags: function () {
    return Session.get('moduleAnalysisTags');
  },

  isCurrentAnalysis: function (_id) {
    let module = Template.parentData();
    if (module && module.analysis) {
      let currentId = (module.analysis[0] && module.analysis[0]._id || module.analysis._id);
      return currentId === _id
    }
  },

  isCurrentAnalysisFilter: function (_id) {
    let currentFilter = Session.get('viewAnalysisFilterValue');
    if (currentFilter) {
      currentFilter = currentFilter.substr(currentFilter.indexOf('##') + 2);
      return _id === currentFilter
    } else {
      return false
    }
  },

  getCurrentAnalysisFilterValue: function () {
    let currentFilter = Session.get('viewAnalysisFilterValue');
    if (currentFilter) {
      return currentFilter.substr(currentFilter.indexOf('##') + 2);
    } else {
      return false
    }
  },

  getCurrentAnalysisFilterType: function () {
    let currentFilter = Session.get('viewAnalysisFilterValue');
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

  getRelease: function () {
    let currentRelease = this.analysis && (this.analysis[0] && this.analysis[0].release || this.analysis.release);
    return Session.get('newRelease') || currentRelease
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  viewAnalysisFilter: function () {
    return Session.get('viewAnalysisFilter');
  },

  hasBranchesOrTags: function () {
    let branches = Session.get('moduleAnalysisBranches');
    let tags = Session.get('moduleAnalysisTags');
    return (branches && branches.length > 0) || (tags && tags.length > 0);
  },

  isLinkedProject: function () {
    return this && this.linkedProject && this.linkedProject.projectId
  },

  scanOptions: function () {
    return {_id : this.analysis && (this.analysis[0] && this.analysis[0].scanId || this.analysis.scanId)}
  },

  currentAnalysisLabel: function () {
    let analysis = this.analysis;
    if (analysis) {
      let current = analysis[0] || analysis;
      if (current.date) {
        let label = moment(current.date).format('lll');
        if (current.release) label += ' - ' + current.release;
        return label;
      }
    }
    return '-- --';
  }

});



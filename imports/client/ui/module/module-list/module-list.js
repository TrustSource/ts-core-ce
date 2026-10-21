import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import {Spacebars} from 'meteor/spacebars';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {Roles} from 'meteor/alanning:roles';
import Notify from '/imports/api/notify';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Module from '/imports/lib/project/Module';
import Approves from '/imports/lib/collections/approves';
import Utils from '/imports/lib/utils';

const TAGS = '[name=tags]'

function initiateProjectApproval(user, now) {
  let project = Projects.findOne(Router.current().params.projectId);
  let release = {
    name:now.toLocaleDateString(),
    initiated:true,
    initiator: user._id,
    initiatorName: Utils.username(),
    date: now
  };
  let releaseData, actionType;
  if (!project.release || project.release.name){
    releaseData = [release];
    actionType = 'set';
  } else {
    releaseData = release;
    actionType = 'push';
  }
  Meteor.callAsync('Projects.UpdateRelease', Router.current().params.projectId, releaseData, actionType).then(function () {
    Meteor.callAsync('logEvent', user, 'Approval initiated for project '+project.name, 'approveProject');
    Meteor.callAsync('notifyAboutInitApproval', user, Router.current().params.projectId);
    Notify.success('Approval was successfully initialized');
    Meteor.setTimeout(function () {
      $('#approvalProject').modal('hide');
    }, 300);
  }).catch(function (updateError) {
    Meteor.callAsync('logEvent', user, 'Error: '+updateError.message, 'approveProject');
    Notify.danger(updateError.message);
  });
}

function handleSelect2Change(sessionKey) {
  let values = $(TAGS).select2('data');
  Meteor.setTimeout(function () {
    applyTagFilter(values, sessionKey);
  }, 1)
}

function applyTagFilter(values, sessionKey) {
  let options = _.map(values, function(item){
    return item.id
  });
  let query = Router.current().params.query;
  if (options.length) {
    _.extend(query, {tags: JSON.stringify(options)});
    Session.set(sessionKey, options);
  } else {
    delete query.tags;
    Session.set(sessionKey, options);
  }
  let newUrl = Router.current().route.path(Router.current().params, {query: query});
  Router.go(newUrl);
}

Template.moduleList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  Session.set('getCompanyTags');
});

Template.moduleList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  const router = Router.current();

  if (router.params.query.filter) {
    Session.set('moduleListFilter', router.params.query.filter);
  }

  if (router.params.query.sorting) {
    Session.set('moduleListSorting', router.params.query.sorting);
  }

  let select2Initialized = false;
  this.autorun(function () {
    const tags = Session.get('getCompanyTags');
    if (!tags || select2Initialized) return;
    Meteor.setTimeout(function () {
      const $el = $(TAGS);
      if (!$el.length) return;
      select2Initialized = true;
      $el.select2({width: '100%'}).on('change.select2', function () {
        handleSelect2Change('moduleListFilterTags');
      });
      const savedTags = Session.get('moduleListFilterTags');
      const query = Router.current().params.query;
      if (savedTags && savedTags.length && !query.tags) {
        _.extend(query, {tags: JSON.stringify(savedTags)});
        let newUrl = Router.current().route.path(Router.current().params, {query: query});
        Router.go(newUrl);
      }
      if (query.tags) {
        const parsed = JSON.parse(query.tags);
        Session.set('moduleListFilterTags', parsed);
        $el.val(parsed).trigger('change');
      }
    }, 50);
  });

  $('#approvalProject').validate({
    rules: {},
    submitHandler: function () {
      const user = Meteor.user();
      const now = new Date();
      Meteor.callAsync('isItPossibleToFreeze', user).then(function(result) {
        if (!result){
          Notify.danger('There is no compliance manager in company. Please assign or invite user with this role');
          return;
        }
        initiateProjectApproval(user, now);
      }).catch(function(error) {
        console.log(error);
        Notify.danger(error.message);
      });
    }
  });

  $('[data-toggle=popover]').popover();
});

Template.moduleList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      const projectId = this.projectId || Projects.UNASSIGNED;
      Router.go('moduleDependencies', {moduleId: this._id, projectId: projectId});
    }
  },
  'click .module-analyze-all': function () {
    Notify.success('Analysis started');
    Meteor.callAsync('analyzeAllModules', this._id).then(function(data) {
      if (data === 0){
        Notify.success('No modules was successfully analyzed. If you have some modules try to analyze them one by one');
      }else{
        Notify.success((data||0)+' modules were analysed successfully.');
      }
    }).catch(function(error) {
      const msg = (error.reason || 'Service is not available');
      Notify.danger('Analysis error: '+ msg);
    })
  },
  'change input[name="search"]': _.throttle(evt => {
    let text = $(evt.target).val().trim();
    let query = Router.current().params.query;
    if (text) {
      _.extend(query, {filter: text});
      Session.set('moduleListFilter', text);
    } else {
      delete query.filter;
      Session.set('moduleListFilter');
    }
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  }, 300),
  'click .sorting': function () {
    let sorting = Session.get('moduleListSorting');
    let query = Router.current().params.query;
    if (!sorting) {
      _.extend(query, {sorting: 'desc'});
      Session.set('moduleListSorting', 'desc');
    } else {
      delete query.sorting;
      Session.set('moduleListSorting');
    }
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  },
  'click .change-state-filter': function (event) {
    event.preventDefault();
    const value = $(event.currentTarget).data('value');
    if (value === 'all') {
      Session.set('moduleFilter');
    } else {
      const filter = {};
      ['ok', 'warnings', 'violations'].forEach(function (key) {
        if (key !== value) filter[key] = true;
      });
      Session.set('moduleFilter', filter);
    }
  },
  'click .rest-filters': function () {
    Session.set('moduleListSorting');
    Session.set('moduleListFilter');
    Session.set('moduleListArchived');
    Session.set('moduleFilter');
    Session.set('moduleListFilterTags');
    $(TAGS).val(null).trigger('change');
    let newUrl = Router.current().route.path(Router.current().params, {});
    Router.go(newUrl);
    Session.set('pageListNumber',1);
  },
  'click .change-presentation-grid': function () {
    Session.set('isCardView',true);
  },
  'click .change-presentation-table': function () {
    Session.set('isCardView',false);
  },
  'click .change-archived-filter': function () {
    Session.set('moduleListArchived',!Session.get('moduleListArchived'));
  }
});

function filteredModules(projectId) {
  let filteredStates = _.map(Session.get('moduleFilter') || {}, function (value, key) {
    return value === true ? key : undefined;
  });
  let filterList = Session.get('moduleListFilter') || '';
  let filterListTags = Session.get('moduleListFilterTags') || [];
  let filterListArchived = Session.get('moduleListArchived') || false;

  const query = {};

  if (projectId === Projects.UNASSIGNED) {
    query.projectId = {$exists: false};
  } else if (projectId) {
    query.projectId = projectId;
  }

  const approveId = Session.get('currentApprove');
  const currentApprove = approveId ? Approves.findOne(approveId): null;
  if(currentApprove){
    query._id = {$in: _.map(currentApprove.modules, function (module) {
      return module._id
    })};
  }

  let result = [];

  let modules = Session.get('modulesByProject');
  let listModules = _.map(_.sortBy(_.filter(modules, (module)=>{
    return (projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId) &&
      (!module.archived || (filterListArchived && module.archived))
  }), 'name'), (module)=>{
    return new Module(module)
  });
  listModules.forEach(p => {
    let analysisId;
    if(currentApprove){
      const approveModule = _.find(currentApprove.modules, function (module) {
        return module._id === p._id
      });
      analysisId = approveModule && approveModule.analysisId;
      p.analysisId = analysisId;
      p.analysisObj = p.getAnalysis(null, analysisId);
    }
    const statistics = p.getStatistics(analysisId);
    const state = statistics && statistics.getState();
    if (p
      && (!filteredStates.length || _.indexOf(filteredStates, state) < 0)
      && (!filterList.length || p.name.toLowerCase().indexOf(filterList.toLowerCase()) > -1)
      && (!filterListTags.length || _.intersection(p.tags, filterListTags).length === filterListTags.length)){
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

Template.moduleList.onCreated(function () {
  const template = this;
  const projectId = Router.current().params.projectId;
  const currentLimit = new ReactiveVar(Session.get('modules-current-limit') || 15);
  const currentPage = new ReactiveVar(Session.get('modules-current-page'+projectId) || 0);
  this.currentLimit = currentLimit;
  this.currentPage = currentPage;

  // This list renders from the `modulesByProject` Session cache, which is filled by one-shot
  // method calls at each mutation site. A module created asynchronously - an import defers
  // processScan, and that is what creates the module - lands after the cache was written, so
  // the page showed "No data found" until a full reload. Subscribe to the matching publication
  // purely as a change signal: whenever the set of module ids for this project changes, refetch
  // the cache the UI actually reads. Keeps the render path (and every other consumer of the
  // Session key) untouched.
  this.subscribe('modulesByProject', projectId || false, true);
  // The catalog entries, for the license on the cards of infrastructure modules.
  this.subscribe('infrastructureComponents');
  this.knownModulesSignature = null;
  this.autorun(function () {
    if (!template.subscriptionsReady()) return;
    const query = projectId === Projects.UNASSIGNED
      ? {projectId: {$exists: false}}
      : {projectId: projectId};
    const modules = Modules.find(query, {fields: {_id: 1, analyzed: 1}, sort: {_id: 1}}).fetch();
    // `analyzed` is part of the signature so the row's statistics refresh when an analysis
    // lands, not just when a module appears or disappears.
    const signature = _.map(modules, function (module) {
      return module._id + ':' + (module.analyzed ? new Date(module.analyzed).getTime() : '');
    }).join(',');
    if (template.knownModulesSignature === signature) return;
    const isFirstRun = template.knownModulesSignature === null;
    template.knownModulesSignature = signature;
    // On mount the cache is normally already correct (the route or the mutation site that
    // navigated here filled it); only refetch when it does not cover these modules.
    if (isFirstRun) {
      const cached = _.filter(Session.get('modulesByProject') || [], function (module) {
        return projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId;
      });
      const cachedIds = _.map(cached, function (module) { return module._id; }).sort().join(',');
      const liveIds = _.map(modules, function (module) { return module._id; }).join(',');
      if (cachedIds === liveIds) return;
    }
    Meteor.callAsync('modulesByProject', false, true).then(function (data) {
      Session.set('modulesByProject', data);
    }).catch(function (error) {
      console.error('modulesByProject refresh failed:', error);
    });
  });
  this.autorun(function () {
    Session.set('modules-current-limit', currentLimit.get());
    Session.set('modules-current-page'+projectId, currentPage.get());
  });

  Session.set('getCompanyTags');
  // Wait for the login resume: on a hard reload this runs while the stored token is still
  // being resumed, and Meteor.userId() (restored from localStorage) reads truthy before the
  // connection is authenticated, so the call was refused with "401 Authentication required".
  // Both are reactive, so the autorun calls once login lands.
  this.autorun(function () {
    if (Meteor.loggingIn() || !Meteor.userId()) return;
    Meteor.callAsync('getCompanyTags').then(function(results) {
      Session.set('getCompanyTags', results);
    });
  });
});

Template.moduleList.helpers({
  isUnassignedProject: function (project) {
    project = project || this;
    return project && project._id === Projects.UNASSIGNED;
  },

  hasModules: function () {
    const res = filteredModules(this._id);
    return res && res.length > 0;
  },

  getProjectOptions: function () {
    return {
      projectId: this._id
    };
  },

  chunkedModules: function (maxSize) {
    const result = [];
    let chunk;

    _.forEach(filteredModules(this._id), (p, i) => {
      if (i % maxSize === 0) {
        chunk = [];
        result.push(chunk);
      }
      chunk[i % maxSize] = p;
    });
    return result;
  },

  getFromChunk: function (idx) {
    return this && this[idx];
  },

  hasFilters: function () {
    const filter = Session.get('moduleFilter');
    return filter && (filter.ok || filter.warnings || filter.violations);
  },

  isDescSorting: function () {
    const filter = Session.get('moduleListSorting');
    return filter || false;
  },

  currentStateFilterLabel: function () {
    const filter = Session.get('moduleFilter') || {};
    const active = ['ok', 'warnings', 'violations'].filter(function (key) {
      return filter[key] === true;
    });
    if (!active.length) return 'All states';
    const visible = ['ok', 'warnings', 'violations'].filter(function (key) {
      return !filter[key];
    });
    if (visible.length === 1) {
      return visible[0].charAt(0).toUpperCase() + visible[0].slice(1);
    }
    return visible.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join(', ');
  },

  isStateActive: function (state) {
    const filter = Session.get('moduleFilter') || {};
    const others = ['ok', 'warnings', 'violations'].filter(function (k) { return k !== state; });
    return others.every(function (k) { return filter[k] === true; }) && !filter[state];
  },

  getStates: function () {
    const filtered = Session.get('moduleFilter') || {};
    let states = ['ok', 'warnings', 'violations'].map(function (key) {
      const label = key === 'ok' ? ' no problems' : key;
      return filtered[key] === true ? undefined : label;
    });
    states = _.compact(states);

    if (states.length === 0) return '';
    if (states.length === 1) return states[0];
    if (states.length === 2) return states[0] + ' or ' + states[1];
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

  isCardView: function () {
    return Session.get('isCardView')
  },

  moduleListArchived: function () {
    return Session.get('moduleListArchived')
  },

  hasModuleCounters: function () {
    const projectId = this._id;
    const total = ReactiveMethod.call('countProjectModules', projectId);
    let modules = Session.get('modulesByProject');
    let listModules = _.filter(modules, (module)=>{
      return projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId
    });
    const current = listModules.length;
    return total > current
  },

  getModuleCounters: function () {
    const projectId = this._id;
    const total = ReactiveMethod.call('countProjectModules', projectId);
    let modules = Session.get('modulesByProject');
    let listModules = _.filter(modules, (module)=>{
      return projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId
    });
    const current = listModules.length;
    return (total > current) ?  current + ' of '+ total +' visible to you. Try to refresh page or contact administrator ' : false
  },

  getCompanyTags: function () {
    return Session.get('getCompanyTags');
  },

  inProgressGetCompanyTags: function () {
    return !Session.get('getCompanyTags');
  },

  hasNoCompanyTags: function () {
    let tags = Session.get('getCompanyTags');
    return tags && tags.length === 0;
  },

  reactiveTableSettings: function () {
    return {
      collection: filteredModules(this._id),
      rowsPerPage: Template.instance().currentLimit,
      currentPage: Template.instance().currentPage,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'state',
          key: 'state',
          label: 'State',
          fn: function (value, object) {
            let state = value;
            if(object.getStatistics){
              state = object.getStatistics().getState();
            }
            const icons = {ok: 'fa-check-circle', warnings: 'fa-exclamation-triangle', violations: 'fa-times-circle'};
            const icon = icons[state] || 'fa-question-circle';
            return new Spacebars.SafeString('<span class="label label-fw bg-'+state+'" sort=' + state + ' title="'+state+'">' +
              '<span class="fa '+icon+'"></span></span>');
          },
          cellClass: 'col-state'
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          sortOrder: 0,
          sortDirection: 'ascending',
          tmpl: Template.reactiveTableModulesName
        },
        {
          fieldId: 'tags',
          key: 'tags',
          label: 'Tags',
          sortable: false,
          tmpl: Template.reactiveTableProjectsTags
        },
        {
          fieldId: 'releases',
          key: 'components',
          label: 'Releases',
          tmpl: Template.reactiveTableModulesReleases,
          cellClass: 'col-100'
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            return object.getStatistics && object.getStatistics().components ? object.getStatistics().components : '';
          },
          cellClass: 'col-120'
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
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          tmpl: Template.reactiveTableModulesActions,
          sortable: false,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableModulesActions.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getProjectId: function () {
    return this.projectId || Projects.UNASSIGNED
  }
});

Template.reactiveTableModulesName.helpers({
  getProjectId: function () {
    return this.projectId || Projects.UNASSIGNED
  },

  getVersion: function () {
    return this.version
  },

  isLinkedProject: function () {
    return this && this.linkedProject && this.linkedProject.projectId
  }
});

Template.reactiveTableModulesReleases.helpers({
  getReleaseQuery: function () {
    return {moduleId:this._id, projectId: this.projectId || Projects.UNASSIGNED}
  }
});

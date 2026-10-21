import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Spacebars} from 'meteor/spacebars';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {ProjectSchema} from '/imports/lib/schemas/projectSchema';

const TAGS = '[name=tags]'

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


// The create-project form lives inside `{{#if isInRole ...}}`, and in Meteor 3 that role
// check resolves asynchronously - so at onRendered neither #createProject nor
// #createProjectForm exists yet and binding to them directly is a no-op. Without a
// validator carrying this submitHandler the submit button falls through to a native GET
// submit (the form has no method/action), which silently reloads /projects?projectName=…
// and creates nothing. Bind on the modal's own shown event instead, via document
// delegation so it works whenever the role finally renders the modal.
function createProjectSubmitHandler(form) {
  // Trim before validating: the server stores the normalised name, so a name that only
  // clears the 3-character minimum because of padding has to be rejected here too -
  // otherwise the instant feedback promises something the server will refuse.
  const projectName = ($(form).find('[name=projectName]').val() || '').trim();
  try {
    ProjectSchema.validate({
      name: projectName,
      companyId: Meteor.user().profile.companyId
    });
    // Instant feedback only, never a guarantee: this lookup is not company-scoped, and for
    // anyone below portfolio_manager Minimongo holds only the projects they are related to,
    // so a name taken by a project they cannot see does not show up here. The server's 409
    // is the authority - it is deliberately a hard refusal, since a human clicking
    // "Create project" means a new one, not somebody else's.
    if (Projects.findOne({name: projectName})) {
      Notify.danger('Error: project with same name already exists');
    } else {
      Meteor.callAsync('Projects.Create', {name: projectName}).then(function () {
        Notify.success('Project successfully created!');
        Meteor.setTimeout(function () {
          $('#createProject').modal('hide');
        }, 300);
      }).catch(function (error) {
        Notify.danger('Error: ' + (error.reason || ' could not create project'));
      });
    }
  } catch (e) {
    Notify.danger('Error: ' + (e.reason || ' could not create project'));
  }
}

function bindCreateProjectValidation() {
  const form = $('#createProjectForm');
  if (!form.length) return;
  // Rebuild the validator on every open: jquery-validation keeps the settings of the
  // first .validate() call, so a bare one made earlier would permanently shadow our
  // submitHandler. Tear the old one down with destroy() - dropping only its "validator"
  // data leaves the submit.validate handler bound to the form, so every reopen added a
  // second, third, ... handler and one submit then created that many projects.
  const existing = form.data('validator');
  if (existing) existing.destroy();
  form.validate({
    rules: {
      projectName: {
        required: true,
        minlength: 3
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: createProjectSubmitHandler
  });
}

Template.projectList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  Session.set('getCompanyTags');
  $(document).off('.projectList');
});

Template.projectList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  $(document).off('.projectList')
    .on('show.bs.modal.projectList', '#createProject', function (e) {
      const validator = $('#createProjectForm').data('validator');
      if (validator) validator.resetForm();
      $(e.currentTarget).find('[name=projectName]').val('').removeClass('error');
      Session.set('createProjectMsg');
    })
    .on('shown.bs.modal.projectList', '#createProject', bindCreateProjectValidation)
    .on('hidden.bs.modal.projectList', '#createProject', function () {
      Session.set('createProjectMsg');
    });
  let router = Router.current();

  if (router.params.query.filter) {
    Session.set('projectListFilter', router.params.query.filter);
  }
  // Restore the box ONCE, here, rather than binding its value reactively in the template:
  // the filter re-renders on every keystroke, and a reactive value fights the user's typing.
  this.$('input[name="search"]').val(Session.get('projectListFilter') || '');
  if (router.params.query.sorting) {
    Session.set('projectListSorting', router.params.query.sorting);
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
        handleSelect2Change('projectListFilterTags');
      });
      const savedTags = Session.get('projectListFilterTags');
      const query = Router.current().params.query;
      if (savedTags && savedTags.length && !query.tags) {
        _.extend(query, {tags: JSON.stringify(savedTags)});
        let newUrl = Router.current().route.path(Router.current().params, {query: query});
        Router.go(newUrl);
      }
      if (query.tags) {
        const parsed = JSON.parse(query.tags);
        Session.set('projectListFilterTags', parsed);
        $el.val(parsed).trigger('change');
      }
    }, 50);
  });

  Session.set('generateInProgress');
  // The form may already be in the DOM (role resolved before this ran); if not, the
  // shown.bs.modal binding above covers it.
  bindCreateProjectValidation();
});

function filteredProjects() {
  let filteredStates = _.map(Session.get('projectFilter') || {}, function (value, key) {
    return value === true ? key : undefined;
  });
  let filterList = Session.get('projectListFilter') || '';
  let filterListTags = Session.get('projectListFilterTags') || [];

  let result = Projects.findMapped();

  let modules = Session.get('modulesByProject');
  let listModules = _.filter(modules, (module)=>{
    return !module.projectId
  });
  let unassignedCnt = listModules.length;
  if (unassignedCnt) {
    result.push(Projects.findUnassigned());
  }

  let haveDemoData = _.any(result,function (project) {
    return project.demo
  });

  Session.set('haveDemoData',haveDemoData);

  let sorting = Session.get('projectListSorting');
  _.sortBy(result, function (item) {
    return item.name.toLowerCase();
  });
  if (sorting) {
    result = result.reverse();
  }
  if (filterList || filteredStates || filterListTags) {
    result = _.filter(result, function (item) {
      const statistics = item.getStatistics && item.getStatistics();
      const state = statistics && statistics.getState()||item.state;
      return item
        && (!filteredStates.length || _.indexOf(filteredStates, state) < 0)
        && (!filterList.length || item.name.toLowerCase().indexOf(filterList.toLowerCase()) > -1)
        && (!filterListTags.length || _.intersection(item.tags, filterListTags).length === filterListTags.length)
    });
  }
  return result;
}

Template.projectList.events = {
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('projectModules', {projectId: this._id});
    }
  },

  'submit #createProjectForm': function (e) {
    e.preventDefault();
  },

  // `keyup`, not `change`: a `change` event on a text input fires only when the field loses
  // focus, so the list did not move while the user typed and the filter read as broken. The
  // throttle below is what keeps the Router.go() beneath it to one call per 300ms rather than
  // one per keystroke - same shape as the license list, which has always filtered as you type.
  'keyup input[name="search"]': _.throttle(evt => {
    let text = $(evt.target).val().trim();
    let query = Router.current().params.query;
    if (text) {
      _.extend(query, {filter: text});
      Session.set('projectListFilter', text);
    } else {
      delete query.filter;
      Session.set('projectListFilter');
    }
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  }, 300),
  'click .sorting': function () {
    let sorting = Session.get('projectListSorting');
    let query = Router.current().params.query;
    if (!sorting) {
      _.extend(query, {sorting: 'desc'});
      Session.set('projectListSorting', 'desc');
    } else {
      delete query.sorting;
      Session.set('projectListSorting');
    }
    let newUrl = Router.current().route.path(Router.current().params, {query: query});
    Router.go(newUrl);
  },
  'click .change-state-filter': function (event) {
    event.preventDefault();
    const value = $(event.currentTarget).data('value');
    if (value === 'all') {
      Session.set('projectFilter');
    } else {
      const filter = {};
      ['ok', 'warnings', 'violations'].forEach(function (key) {
        if (key !== value) filter[key] = true;
      });
      Session.set('projectFilter', filter);
    }
  },
  'click .rest-filters': function (event, templateInstance) {
    // The search box no longer mirrors the session reactively (see project-list.html), so
    // clearing the filter has to clear the field too. Scoped to the template rather than to a
    // wrapper class: no markup currently renders `.rest-filters`, so this handler is dormant,
    // and a structural selector would be guesswork about markup that does not exist yet.
    templateInstance.$('input[name="search"]').val('');
    Session.set('projectListSorting');
    Session.set('projectListFilter');
    Session.set('projectFilter');
    Session.set('projectListFilterTags');
    let newUrl = Router.current().route.path(Router.current().params, {});
    Router.go(newUrl);
  },
  'click .generate-project': function () {
    Session.set('generateInProgress',true);
    let user = Meteor.user();
    if(user){
      Meteor.callAsync('generateDemoData').then(function(result) {
        Session.set('generateInProgress');
        if (result && result.existing) {
          Notify.info('The company already has a demo project.');
        }
        Meteor.setTimeout(()=>{
          Meteor.callAsync('modulesByProject', false, true).then(data => {
            Session.set('modulesByProject', data)
          })
        }, 1)
      }).catch(function (error) {
        // A refusal (role, rate limit) left the spinner up and both demo buttons hidden
        // until a reload.
        Session.set('generateInProgress');
        Notify.danger(error.reason || 'Could not load the demo project');
      })
    }
  },
  'click .remove-demo': function () {
    Session.set('generateInProgress',true);
    let user = Meteor.user();
    if(user){
      Meteor.callAsync('removeDemoData').then(function() {
        Session.set('generateInProgress');
        Meteor.setTimeout(()=>{
          Meteor.callAsync('modulesByProject', false, true).then(data => {
            Session.set('modulesByProject', data)
          })
        }, 1)
      }).catch(function (error) {
        Session.set('generateInProgress');
        Notify.danger(error.reason || 'Could not remove the demo data');
      })
    }
  },
  'click .change-presentation-grid': function () {
    Session.set('isCardView',true);
  },
  'click .change-presentation-table': function () {
    Session.set('isCardView',false);
  }
};

Template.projectList.onCreated(function () {
  const template = this;
  const currentLimit = new ReactiveVar(Session.get('projects-current-limit') || 15);
  const currentPage = new ReactiveVar(Session.get('projects-current-page') || 0);
  this.currentLimit = currentLimit;
  this.currentPage = currentPage;

  // Same change signal as the module list: the rows render from the `modulesByProject`
  // Session cache, filled by one-shot method calls. The demo project's module is analysed
  // in a deferred processScan after `generateDemoData` returns (and a scan import works
  // the same way), so the refetch at that call site ran before the analysis landed and the
  // row stayed at "0 components / No data available" until a reload. Refetch whenever a
  // module appears, disappears or is (re)analysed. On mount the cache is normally already
  // correct (the per-user bootstrap or the mutation that navigated here filled it), so the
  // first run only refetches when the cache does not cover these modules.
  this.subscribe('modulesByProject', false, true);
  let knownModulesSignature = null;
  this.autorun(function () {
    if (!template.subscriptionsReady()) return;
    const modules = Modules.find({}, {fields: {_id: 1, analyzed: 1}, sort: {_id: 1}}).fetch();
    const signature = _.map(modules, function (module) {
      return module._id + ':' + (module.analyzed ? new Date(module.analyzed).getTime() : '');
    }).join(',');
    if (knownModulesSignature === signature) return;
    const isFirstRun = knownModulesSignature === null;
    knownModulesSignature = signature;
    if (isFirstRun) {
      const cachedIds = _.map(Session.get('modulesByProject') || [], function (module) {
        return module._id;
      }).sort().join(',');
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
    Session.set('projects-current-limit', currentLimit.get());
    Session.set('projects-current-page', currentPage.get());
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

Template.projectList.helpers({

  createProjectMsgType: function () {
    let msg = Session.get('createProjectMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createProjectMsg: function () {
    return Session.get('createProjectMsg');
  },

  projects: function () {
    return filteredProjects();
  },

  hasFilters: function () {
    const filter = Session.get('projectFilter');
    return filter && (filter.ok || filter.warnings || filter.violations);
  },

  isDescSorting: function () {
    const filter = Session.get('projectListSorting');
    return filter || false;
  },

  getStates: function () {
    let filtered = Session.get('projectFilter') || {};
    let states = ['ok', 'warnings', 'violations'].map(function (key) {
      const label = key === 'ok' ? ' no problems' : key;
      return filtered[key] === true ? undefined : label;
    });
    states = _.compact(states);
    if (states.length === 0) return '';
    if (states.length === 1) return states[0];
    if (states.length === 2) return states[0] + ' or ' + states[1];
  },

  currentStateFilterLabel: function () {
    const filter = Session.get('projectFilter') || {};
    const active = ['ok', 'warnings', 'violations'].filter(function (key) {
      return filter[key] === true;
    });
    if (!active.length) return 'All states';
    // Show what's visible (not filtered out)
    const visible = ['ok', 'warnings', 'violations'].filter(function (key) {
      return !filter[key];
    });
    if (visible.length === 1) {
      return visible[0].charAt(0).toUpperCase() + visible[0].slice(1);
    }
    return visible.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join(', ');
  },

  isStateActive: function (state) {
    const filter = Session.get('projectFilter') || {};
    // "active" in dropdown = this is the only visible state
    const others = ['ok', 'warnings', 'violations'].filter(function (k) { return k !== state; });
    return others.every(function (k) { return filter[k] === true; }) && !filter[state];
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

  noGenerate: function () {
    return !Session.get('generateInProgress')
  },

  hasDemo: function () {
    return Session.get('haveDemoData');
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  isCardView: function () {
    return Session.get('isCardView')
  },

  hasProjectCounters: function () {
    const total = ReactiveMethod.call('countCompanyProject');
    const current = Projects.find({},{fields:{name:1}}).count();
    return total > current
  },

  getProjectCounters: function () {
    const total = ReactiveMethod.call('countCompanyProject');
    const current = Projects.find({},{fields:{name:1}}).count();
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
      collection: filteredProjects(),
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
            if(object._id === Projects.UNASSIGNED){
              return ''
            }
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
          tmpl: Template.reactiveTableProjectsName
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
          tmpl: Template.reactiveTableProjectsReleases,
          cellClass: 'col-100'
        },
        {
          fieldId: 'moduleCount',
          key: 'moduleCount',
          label: 'Modules',
          fn: function (value, object) {
            return object._id !== Projects.UNASSIGNED ? object.moduleCount : '';
          },
          cellClass: 'col-80 text-center'
        },
        {
          fieldId: 'components',
          key: 'components',
          label: 'Components',
          fn: function (value, object) {
            const componentCount = object.getStatistics ? object.getStatistics().components : 0;
            return object._id !== Projects.UNASSIGNED ? componentCount : '';
          },
          cellClass: 'col-120 text-center'
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
          tmpl: Template.reactiveTableProjectsActions,
          sortable: false,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableLegalStats.helpers({
  getStatistics: function (analysisId) {
    return this.getStatistics(analysisId).getAll()
  },
  getOk: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().legal.okPercent || 0) * 100) / 100;
  },
  getWarnings: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().legal.warningsPercent || 0) * 100) / 100;
  },
  getViolations: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().legal.violationsPercent || 0) * 100) / 100;
  }
});

Template.reactiveTableVulnerabilityStats.helpers({
  getStatistics: function (analysisId) {
    return this.getStatistics(analysisId).getAll()
  },
  getOk: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().vulnerability.okPercent || 0) * 100) / 100;
  },
  getWarnings: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().vulnerability.warningsPercent || 0) * 100) / 100;
  },
  getViolations: function (analysisId) {
    return this.getStatistics && Math.round((this.getStatistics(analysisId).getAll().vulnerability.violationsPercent || 0) * 100) / 100;
  }
});

Template.reactiveTableQualityStats.helpers({
  getStatistics: function () {
    return this.getQuality()
  },
  getOk: function () {
    return this.getQuality() && Math.round((this.getQuality().okPercent || 0) * 100) / 100;
  },
  getWarnings: function () {
    return this.getQuality() && Math.round((this.getQuality().warningsPercent || 0) * 100) / 100;
  },
  getViolations: function () {
    return this.getQuality() && Math.round((this.getQuality().violationsPercent || 0) * 100) / 100;
  }
});

Template.reactiveTableProjectsActions.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  isNotUnassigned: function () {
    return this._id !== Projects.UNASSIGNED
  }
});

Template.reactiveTableProjectsTags.helpers({
  tags: function () {
    if(this.tags && this.tags.length){
      const tags = Session.get('getCompanyTags');
      return _.filter(_.map(this.tags, function(item){
        return tags && tags.find(function (tag) {
          return tag._id === item
        })
      }), function(item){
        return !!item
      })
    }
    return []
  }
});

Template.reactiveTableProjectsReleases.onCreated(function () {
  let loading = new ReactiveVar();
  let details = new ReactiveVar();
  this.details = details;
  this.loading = loading;
});

Template.reactiveTableProjectsReleases.helpers({
  getReleaseQuery: function () {
    return {projectId:this._id}
  },
  isUnassigned: function () {
    return this._id === Projects.UNASSIGNED
  },
  isLoading: function () {
    const instance = Template.instance();
    return instance.loading && instance.loading.get()
  },
  releaseCounter: function (){
    const instance = Template.instance();
    if(instance.details && !instance.details.get()){
      instance.loading.set(true)
      Meteor.callAsync('getReleasesCountByProject', {projectId: this._id}).then(data => {
        if(data){
          instance.details.set(data)
        }
        instance.loading.set(false)
        return data
      })
    }
    return instance.details && instance.details.get()
  }
});


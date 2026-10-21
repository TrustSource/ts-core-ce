/* global document:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {ReactiveVar} from 'meteor/reactive-var';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';
import Company from '/imports/lib/company/Company';
import Notify from '/imports/api/notify';

Template.moduleDependencies.onCreated(function () {
  Session.set('listStatus');
  Session.set('currentComponent');
  this.mappedVulns = new ReactiveVar();
});

Template.moduleDependencies.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('moduleComponents', undefined);
  Session.set('moduleLastScan', undefined);
  Session.set('pageListSize', 15);

  this.autorun(function () {
    // On a hard reload / deep link the DDP connection is not authenticated yet, so these
    // calls get rejected by the server's auth guard ("Authentication required") and nothing
    // retried them - an error toast over a permanently empty list. Meteor.userId() alone is
    // not enough of a guard: it is restored from localStorage before the resume handshake
    // completes, so it reads truthy while the connection is still anonymous. Both are
    // reactive, so this autorun re-runs and loads for real once login actually lands.
    if (Meteor.loggingIn() || !Meteor.userId()) return;
    if (Router.current().params.moduleId) {
      const moduleId = Router.current().params.moduleId;
      const analysisId = Router.current().params.query.analysis;
      Meteor.callAsync(
        'getModuleComponents',
        moduleId,
        analysisId
      ).then(function(data) {
        Session.set('moduleComponents', data || []);
      }).catch(function (error) {
        // Leaving this unhandled left `moduleComponents` undefined, i.e. the list spinner
        // running forever with nothing reported. Show the empty state and say what happened.
        console.error('getModuleComponents failed:', error);
        Session.set('moduleComponents', []);
        Notify.danger('Error: ' + (error.reason || 'could not load module components'));
      });
      Meteor.callAsync('getLastModuleScan', moduleId, analysisId).then(function (scan) {
        Session.set('moduleLastScan', scan);
      }).catch(function (error) {
        console.error('getLastModuleScan failed:', error);
      });
    }
  });
});

Template.moduleDependencies.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  Session.set('moduleComponents', undefined);
  Session.set('moduleLastScan', undefined);
  Session.set('currentComponent');
});

Template.moduleDependencies.helpers({
  getComponents: function () {
    const module = this;
    const components = Session.get('moduleComponents');
    if (module && module._id && components) {
      Session.set('listStatus');
      const project = Projects.findOne(module.projectId);
      const company = Session.get('company')
      const companyClass = new Company(company);
      const page = Session.get('pageListNumber') || 1;
      const size = Session.get('pageListSize') || 10;
      const vulnConfidence = Session.get('moduleDetailConfidenceMinScore') || Utils.resolveConfidenceMinScore(module, project, 4);
      let result = Utils.defineComponentsList(module, project, companyClass, components, false, vulnConfidence);
      let sorting = Session.get('moduleDetailListSorting');
      result = _.sortBy(result, function (item) {
        return item.getName();
      });
      result = _.sortBy(result, function (item) {
        return item.root;
      });
      if (sorting) {
        result = result.reverse();
      }
      let currentComponents = result.slice(size*(page-1),size*page);
      // 'empty' means "loaded, nothing to show" and renders the empty state; a 0 here means the
      // current page slice is momentarily empty while a large scan loads, which keeps the
      // spinner up. Without the distinction a module with no components spun forever.
      Session.set('listStatus', result.length ? currentComponents.length : 'empty');
      if (currentComponents && Router.current().params.query && Router.current().params.query.filter && currentComponents.length === 1) {
        Session.set('currentComponent', currentComponents[0].getKey())
      }
      // Auto-select first component if none selected
      if (!Session.get('currentComponent') && currentComponents.length > 0) {
        Session.set('currentComponent', currentComponents[0].getKey())
      }
      return {
        filtered:currentComponents,
        all:result
      };
    }
  },
  isGraphView: function () {
    const components = Session.get('moduleComponents') || null;
    return Session.get('activeView') === 'moduleGraphs' && components;
  },
  isTreeView: function () {
    const components = Session.get('moduleComponents') || null;
    return Session.get('activeView') === 'moduleTree' && components;
  },
  isListSubView: function () {
    return Session.get('activeView') === 'moduleTests';
  },
  isTestsView: function () {
    return Session.get('activeView') === 'moduleTests';
  },
  isExtView: function () {
    const components = Session.get('moduleComponents') || null;
    const view = Session.get('activeView');
    return (view === 'moduleTree' || view === 'moduleTests' ||
      view === 'moduleGraphs') && components;
  },
  isInfrastructureModule: function () {
    const test = (Template.currentData() && Template.currentData().properties &&
        (Template.currentData().properties.architecture === 'infrastructureModule' ||
          Template.currentData().properties.architecture === 'infrastructureTemplate')) ||
      (Template.currentData() && Template.currentData().properties &&
        (Template.currentData().properties.architecture === 'cotsModule' ||
          Template.currentData().properties.architecture === 'cotsTemplate'))
    let module = Template.parentData(0);
    if(test && module.analysis && module.analysis[0] && module.analysis[0].components){
      const component = module.analysis[0].components[0]
      Session.set('currentComponent', component.key);
    }
    return test
  },
  requestInProgress: function () {
    const status = Session.get('listStatus');
    // Treat 0 as "still loading" (spinner), matching the Components tab.
    // A transient empty derived list during a large-scan load would otherwise
    // flash the "no data" empty state before the content renders.
    return (status === 0 || !status);
  },
  currentComponent: function () {
    return Session.get('currentComponent');
  },
  moduleListFilterOptions: function () {
    return {
      layoutDependency:true
    };
  },
  getModuleOptions: function () {
    return {
      moduleId: Router.current().params.moduleId,
      projectId: Router.current().params.projectId
    };
  },
  isDescSorting: function () {
    return Session.get('moduleDetailListSorting') || false;
  }
});

Template.moduleDependencies.events({
  'keyup .module-deps-search input[name=search]': function (event) {
    Session.set('moduleDetailListFilter', event.target.value);
    Session.set('pageListNumber', 1);
  },
  'click .module-deps-heading .sorting': function () {
    Session.set('moduleDetailListSorting', !Session.get('moduleDetailListSorting'));
  }
});

Template.moduleDependenciesChart.onCreated(function () {
  let componentList = new ReactiveVar();
  this.componentList = componentList;
  const current = Session.get('moduleDetailConfidenceMinScore')
  if(!current){
    Session.set('moduleDetailConfidenceMinScore')
  }
});

Template.moduleDependenciesChart.helpers({
  statistics: function () {
    const module = Template.currentData();
    const filter = Router.current().params.query.analysis || null;
    const statistics = module && module.getStatistics(filter);
    return statistics && statistics.getAll();
  },
  isVersioningDisabled: function () {
    const module = Template.parentData();
    const filter = Router.current().params.query.analysis || null;
    const analysis = module && module.getAnalysis ? module.getAnalysis(null, filter) : false;
    return !(analysis && analysis.versioningConfig && analysis.versioningConfig.enabled)
  },
  getModuleOptions: function () {
    return {
      moduleId:Router.current().params.moduleId,
      projectId:Router.current().params.projectId
    };
  }
});

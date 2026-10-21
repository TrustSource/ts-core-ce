import {Meteor} from 'meteor/meteor';
import {moment} from 'meteor/momentjs:moment';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Projects from '/imports/lib/collections/projects';
import {RESOLVED_RISK_STATES} from '/imports/lib/schemas/riskSchema';
// import { Tracker } from 'meteor/tracker';

function initProjectList() {
  let result = Projects.findMapped();
  Session.set('companyProjects',result);

  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  const analysis = Router.current().params.query && Router.current().params.query.analysis;
  const riskId = Router.current().params.query && Router.current().params.query.riskId;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    if (analysis) {
      newUrl = newUrl + '&analysis=' + analysis;
    }
    if (riskId) {
      newUrl = newUrl + '&riskId=' + riskId;
      Session.set('editRiskDetails',riskId)
    }
    Router.go(newUrl);
  }
  Meteor.setTimeout(function () {
    // scope to <select> elements - a bare '.select2' also matches select2's own
    // container spans and re-initializes them as empty single-select ghosts
    $('select.select2').select2({width: '100%'});
    $('[data-toggle=popover]').popover();
    getData(true)
  },100)
}

Template.risks.onRendered(function () {
  Session.set('requestInProgress',false)
  Session.set('editRiskDetails')
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      initProjectList();
      Meteor.clearInterval(timerId);
    }
  }, 100)
  Session.set('getUsers');
  this.autorun((c) => {
    const user = Meteor.user();
    if (!user) return;
    c.stop();
    Meteor.callAsync('getUsers', user).then(function(results) {
      let list = _.map(results, function (u) {
        return {label: u.profile.name, value: u._id}
      });
      Session.set('getUsers', list);
    });
  });

  this.autorun(() => {
    // Opened as the first page, the call would run before the login has resumed.
    if (Meteor.loggingIn() || !Meteor.userId()) {
      return;
    }
    const q = (Router.current() && Router.current().params && Router.current().params.query) || {};
    const projectId = q.projectId;
    const moduleId = q.moduleId;
    if (projectId || moduleId) {
      getData(true);
    } else {
      Session.set('getRiskSettingsList', null);
    }

    // Tracker.afterFlush(() => {
    //   const $sel = this.$ && this.$('.current-project');
    //   if (!$sel || !$sel.length) return;
    //   const desiredVal = moduleId ? (projectId ? `${projectId}_m_${moduleId}` : '') : (projectId || '');
    //   $sel.val(desiredVal || '').trigger('change');
    // });
  });
});

Template.risks.onDestroyed(function () {
  const $sel = this.$ && this.$('.current-project');
  if ($sel && $sel.length && $sel.hasClass('select2-hidden-accessible')) {
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    try { $sel.select2('destroy'); } catch (e) {
      // no actions here
    }
  }
});

function getData(requestInProgress){
  if(requestInProgress){
    Session.set('requestInProgress', true);
    Session.set('getRiskSettingsList');
  }
  if(Router.current().params.query.projectId){
    const moduleId = Router.current().params.query.moduleId
    const projectId = Router.current().params.query.projectId
    Meteor.callAsync('RiskProperties.Find', {moduleId, projectId}).then(function(data) {
      Session.set('getRiskSettingsList', _.sortBy((data ? data : []), 'created').reverse());
      Session.set('requestInProgress', false);
    });
  }else{
    Session.set('getRiskSettingsList', null);
  }
}

Template.risks.events = {
  'change .current-project': function (event) {
    let currentCode = $(event.target).val();
    if(currentCode){
      let moduleId = currentCode.split('_m_')[1];
      let projectId = currentCode.split('_m_')[0];
      let newUrl = Router.current().route.path()+'?projectId='+projectId;
      if (moduleId) {
        newUrl = newUrl + '&moduleId='+moduleId;
      }
      Router.go(newUrl);
      Session.set('editRiskDetails')
    }
  }
};

Template.risks.helpers({
  projectList: function () {
    return Session.get('companyProjects');
  },
  getReportData: function () {
    return Session.get('getRiskSettingsList')
  },
  isActiveProject: function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule: function () {
    return Router.current().params.query.moduleId === this._id
  },
  getDocId: function () {
    return Router.current().params.query.moduleId || Router.current().params.query.projectId
  },
  editId: function () {
    return Session.get('editRiskDetails')
  },
  editDetails: function () {
    const _id = Session.get('editRiskDetails')
    const allData = Session.get('getRiskSettingsList')
    if (allData instanceof Array) {
      return _.find(allData, function (elem) {
        return elem._id === _id;
      });
    }
  },
  getViewType: function () {
    return Router.current().params.query.moduleId  ? 'moduleCmpRisksSettings' : 'projCmpRisksSettings'
  },
  selectProject: function () {
    return Router.current().params.query.projectId
  },
  noDataInProject: function () {
    return Session.get('getRiskSettingsList') && Session.get('getRiskSettingsList').length === 0
  },
  requestInProgress: function () {
    return Router.current().params.query.projectId && Session.get('companyProjects') &&
      Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Router.current().params.query.projectId;
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  },
  getRiskQueryParams: function () {
    let params = {}
    if(Router.current().params.query.projectId){
      params.projectId = Router.current().params.query.projectId
    }
    if(Router.current().params.query.moduleId){
      params.moduleId = Router.current().params.query.moduleId
    }
    return params
  },
  getStats: function () {
    const allData = Session.get('getRiskSettingsList') || []
    const sevenDaysAgo = moment().subtract(7, 'days');
    const resolvedStates = RESOLVED_RISK_STATES;
    return {
      risks: allData.length,
      new: allData.filter(function (item) {
        return moment(item.created).isAfter(sevenDaysAgo)
      }).length,
      opened: allData.filter(function (item) {
        return resolvedStates.indexOf(item.riskProperties.state) === -1
      }).length,
      resolved: allData.filter(function (item) {
        return resolvedStates.indexOf(item.riskProperties.state) > -1
      }).length
    }
  }
});

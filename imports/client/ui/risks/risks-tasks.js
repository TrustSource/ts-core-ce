import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Projects from '/imports/lib/collections/projects';
import { Tracker } from 'meteor/tracker';

function initProjectList() {
  let result = Projects.findMapped();
  Session.set('companyProjects',result);

  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  const analysis = Router.current().params.query && Router.current().params.query.analysis;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    if (analysis) {
      newUrl = newUrl + '&analysis=' + analysis;
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

Template.risksTasks.onRendered(async function () {
  Session.set('requestInProgress',false);
  Session.set('editRiskDetails');
  Session.set('tasksViewType', 'My');
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
    const q = (Router.current() && Router.current().params && Router.current().params.query) || {};
    const projectId = q.projectId;
    const moduleId = q.moduleId;
    if (projectId || moduleId) {
      getData(true);
    } else {
      Session.set('riskTaskList', null);
    }

    Tracker.afterFlush(() => {
      const $sel = this.$ && this.$('.current-project');
      if (!$sel || !$sel.length) return;
      const moduleVal = projectId ? `${projectId}_m_${moduleId}` : '';
      const desiredVal = moduleId ? moduleVal : (projectId || '');
      $sel.val(desiredVal || '').trigger('change');
    });
  });
});

Template.risksTasks.onDestroyed(function () {
  const $sel = this.$ && this.$('.current-project');
  if ($sel && $sel.length && $sel.hasClass('select2-hidden-accessible')) {
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    try { $sel.select2('destroy'); } catch (e) {
      // no actions here
    }
  }
});

async function getData(requestInProgress){
  if(requestInProgress){
    Session.set('requestInProgress', true);
    Session.set('riskTaskList');
  }
  if(Router.current().params.query.projectId){
    const moduleId = Router.current().params.query.moduleId
    const projectId = Router.current().params.query.projectId
    try {
      const data = await Meteor.callAsync('Tasks.FindByRisks', {moduleId, projectId});
      Session.set('riskTaskList', _.sortBy((data ? data : []), 'created').reverse());
      try {
        const cmData = await Meteor.callAsync('RiskPropertiesCountermeasures.Find', {moduleId, projectId});
        Session.set('riskCountermeasureList', cmData);
        Session.set('requestInProgress', false);
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (error) {
        Session.set('requestInProgress', false);
      }
    // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (error) {
      Session.set('requestInProgress', false);
    }
  }else{
    Session.set('riskTaskList', null);
  }
}

Template.risksTasks.events = {
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

Template.risksTasks.helpers({
  getReportData: function () {
    return Session.get('riskTaskList')
  },
  projectList: function () {
    return Session.get('companyProjects');
  },
  getCountermeasures: function () {
    return Session.get('riskCountermeasureList')
  },
  isActiveProject: function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule: function () {
    return Router.current().params.query.moduleId === this._id
  },
  selectProject: function () {
    return Router.current().params.query.projectId
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
    const allData = Session.get('riskTaskList') || []
    const now = moment();
    const sevenDaysAfter = moment().add(7, 'days');
    const openedTaskStatuses = ['planned','in_progress','in_review']
    return {
      tasks: allData.length,
      upcoming: allData.filter(function (item) {
        return item.due && moment(item.due).isAfter(now) && moment(item.due).isBefore(sevenDaysAfter) && item.status
          && item.status !== 'completed'
      }).length,
      opened: allData.filter(function (item) {
        return item.status && openedTaskStatuses.indexOf(item.status) > -1
      }).length,
      resolved: allData.filter(function (item) {
        return item.status === 'completed'
      }).length
    }
  }
});

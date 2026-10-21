import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';
import {moment} from 'meteor/momentjs:moment';

Template.reportTfs.events = {
  'change .current-project': function (event) {
    Session.set('reportProject', $(event.target).val());
  }
};
Template.reportTfs.helpers({
  getTitle: function() {
    return this.fields['System.Title'];
  },
  getDescription: function() {
    return this.fields['System.Description'] || this.fields['Microsoft.VSTS.TCM.ReproSteps'];
  },
  getState: function() {
    return this.fields['System.State'];
  },
  getStateColor: function() {
    return this.fields['System.StateColor'];
  },
  getCreatedDate: function () {
    return moment(this.fields['System.CreatedAt']).format('lll');
  },
  getCreatedBy: function() {
    return this.fields['System.CreatedBy'];
  },
  getProjectTfsTasks: function () {
    if (!Session.get('reportProject')) {
      return [];
    }
    Session.set('requestInProgress', true);
    let getList = ReactiveMethod.call('tfs.workItems.getAll', Session.get('reportProject'), {Tag: 'trustsource_issue'});
    Session.set('reportProjectTfsIssues', getList);
    if (getList) {
      Session.set('requestInProgress', false);
      return getList;
    } else {
      return [];
    }
  },
  getProjectTfsTasksStatus: function () {
    return Session.get('reportProjectTfsIssues');
  },
  getStatusStats: function () {
    let statuses = _.groupBy(_.map(Session.get('reportProjectTfsIssues'), function (issue) {
      return {key: issue.fields['System.State'], color: issue.fields['System.StateColor']};
    }), 'key');
    statuses = _.map(statuses, function (list, key) {
      return {
        key: key,
        color: list[0].color,
        count: list.length
      }
    });
    return statuses;
  },
  getWidthOfStatus: function (list) {
    return 100 / list.length
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    let list = Session.get('reportProjectTfsIssues');
    return ( list && list.length === 0 ) && list !== false
  },
  noConnection: function () {
    let list = Session.get('reportProjectJiraIssues');
    return list === false
  },
  requestInProgress: function () {
    let list = Session.get('reportProjectJiraIssues');
    return list !== false && Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
    return current && projects && _.find(projects, function (item) {
      return item._id === current
    }).name
  }
});

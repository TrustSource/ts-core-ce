/* global Promise:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {moment} from 'meteor/momentjs:moment';
import Projects from '/imports/lib/collections/projects';
import Utils from '/imports/lib/utils';

function initProjectSettings(project,Company){
  if (project && project.github && project.github.active) {
    const settings = _.extend(Company.github, Utils.removeEmpty(_(project.github).clone()));
    Session.set('github', settings && settings.active);
  }else{
    Session.set('github', Company.github.active);
  }
}

Template.reportGithub.onRendered(function () {
  const Company = Session.get('company');
  if (Company && Company.github && Company.github.active) {
    Session.set('github', Company.github.active);
  } else {
    Session.set('github');
  }
  const routerProjectId = Session.get('reportProject');
  if(routerProjectId){
    Session.set('reportProject',routerProjectId);
    const Project = Projects.findOne(routerProjectId);
    initProjectSettings(Project,Company)
  }
});
Template.reportGithub.events = {
  'change .current-project': function (event) {
    const routerProjectId = $(event.target).val();
    const Project = Projects.findOne(routerProjectId);
    const Company = Session.get('company');
    initProjectSettings(Project,Company);
    Session.set('reportProject', routerProjectId);
  }
};
Template.reportGithub.helpers({
  githubApp: function () {
    return Session.get('githubApp');
  },
  getCreatedDate: function () {
    return moment(this.fields.created).format('lll')
  },
  getProjectGithubTasks: function () {
    Session.set('requestInProgress', true);
    let projectId = Session.get('reportProject');
    let modules = Session.get('modulesByProject');
    if(modules){
      let urls = _.filter(_.map(_.filter(modules, (module)=>{
        return (projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId) && !module.archived
      }), (module)=>{
        return module && module.urls && module.urls.repository
      }), (url)=>{
        return url
      })
      let promises = _.map(urls,(url)=>{
        return new Promise((resolve, reject) =>
          Meteor.callAsync('tsGithubGetIssueList', Session.get('reportProject'), url).then(function(result) {
            resolve(result);
          }).catch(function(error) {
            console.log(error);
            reject(error);
          })
        );
      })
      Promise.all(promises).then((responses) => {
        let list = []
        _.forEach(responses,(response)=>{
          if(response.status === 200 && response.data){
            list.push(response.data)
          }
        });
        list = _.flatten(list)
        Session.set('reportProjectGithubIssues', list);
        Session.set('requestInProgress', false);
      });
      return urls.length
    }
  },
  getProjectGithubTasksStatus: function () {
    return Session.get('reportProjectGithubIssues');
  },
  getStatusStats: function () {
    let statuses = _.groupBy(Session.get('reportProjectGithubIssues'),'state');
    statuses = _.sortBy(_.map(statuses,function (list,key) {
      return {
        key:key,
        color: key === 'open' ? 'green': 'medium-gray',
        order: key === 'open' ? 0 : 1,
        count:list.length
      }
    }),'order');
    return statuses;
  },
  getIssueColor: function () {
    return this.state === 'open' ? 'green': 'medium-gray';
  },
  getWidthOfStatus: function (list) {
    return 100/list.length
  },
  selectProject: function () {
    return !Session.get('reportProject')
  },
  noDataInProject: function () {
    let list = Session.get('reportProjectGithubIssues');
    return ( list && list.length === 0 ) && list !== false
  },
  noConnection: function () {
    let list = Session.get('reportProjectGithubIssues');
    return list === false
  },
  requestInProgress: function () {
    let list = Session.get('reportProjectGithubIssues');
    return list !== false && Session.get('companyProjects') && Session.get('companyProjects').length > 0 && Session.get('requestInProgress')
  },
  getProjectName: function () {
    let projects = Session.get('companyProjects');
    let current = Session.get('reportProject');
    return current && projects && _.find(projects,function (item) {
      return item._id === current
    }).name
  }
});

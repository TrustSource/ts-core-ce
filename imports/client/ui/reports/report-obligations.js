 
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Roles} from 'meteor/alanning:roles';
import {moment} from 'meteor/momentjs:moment';
import Projects from '/imports/lib/collections/projects';

import Notify from '/imports/api/notify';
import Module from '/imports/lib/project/Module';

Template.reportObligations.onRendered(function () {
  let result = Projects.findMapped();
  const projectId = Router.current().params.query.projectId;
  const moduleId = Router.current().params.query.moduleId;
  if(projectId) {
    let newUrl = Router.current().route.path() + '?projectId=' + projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId=' + moduleId;
    }
    Router.go(newUrl);
  }
  if(!projectId || !_.any(result,function (item) {return item._id === projectId})){
    let newUrl = Router.current().route.path()+'?projectId='+(result[0] && result[0]._id);
    Router.go(newUrl);
  }
  let timerId = Meteor.setInterval(function () {
    if(Session.get('modulesByProject')) {
      result = Projects.findMapped();
      Session.set('companyProjects', result);
      Meteor.clearInterval(timerId);
      Meteor.setTimeout(function () {
        $('.select2').select2({width: '100%'});
      },1)
    }
  }, 100)
});

function mapReleases(releases, release) {
  const date = new Date();
  return _.map(releases,function (item) {
    if (moment(item.date).unix() === moment(release.date).unix()){
      release.date = date;
      delete release.initiated;
      return release;
    }else{
      return item
    }
  });
}

function updateApprove(user,releaseForm) {
  if (Roles.userIsInRole(user, ['compliance_manager'], user.profile.companyId)) {
    if(Router.current().params.query.moduleId){
      let modules = Session.get('modulesByProject');
      modules = _.filter(modules, (module)=>{
        return module._id === Router.current().params.query.moduleId
      });
      const module = modules && modules[0];
      let releases = mapReleases(module.release, releaseForm);
      Meteor.callAsync('Modules.UpdateRelease', module._id, releases).then(() => {
        Notify.success('Module was successfully updated');
        Meteor.callAsync('logEvent', user,
          'Approval for module '+module.name+' '+(releaseForm.approved?'granted.':'rejected.')+
          ' Comment was: ' + releaseForm.comment, 'approveModule');
        if(releaseForm.approved){
          Meteor.callAsync('notifyAboutApproveModule', user, module._id);
        }else{
          Meteor.callAsync('notifyAboutApproveModuleReject', user, module._id);
        }
      }).catch((error) => {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'approveModule');
      });
    }else if (Router.current().params.query.projectId){
      const project = Projects.findOne(Router.current().params.query.projectId);
      let releases = mapReleases(project.release, releaseForm);
      Meteor.callAsync('Projects.UpdateRelease', project._id, releases).then(() => {
        Notify.success('Project was successfully updated');
        Meteor.callAsync('logEvent', user, 'Approval for project '+project.name+' '+(releaseForm.approved?'granted.':'rejected.')+
          ' Comment was: ' + releaseForm.comment,
        'approveProject');
        Meteor.callAsync('notifyAboutApprove', user, project._id);
      }).catch((error) => {
        Notify.danger(error.message);
        Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'approveProject');
      });
    }
  }else{
    Notify.danger('You are not allowed to change this settings!');
  }
}

Template.reportObligations.events = {
  'change .current-project': function (event) {
    let currentCode = $(event.target).val();
    let moduleId = currentCode.split('_m_')[1];
    let projectId = currentCode.split('_m_')[0];
    let newUrl = Router.current().route.path()+'?projectId='+projectId;
    if (moduleId) {
      newUrl = newUrl + '&moduleId='+moduleId;
    }
    Router.go(newUrl);
  },
  'click .approve-project': function (event) {
    const user = Meteor.user();
    const now = new Date();
    let releaseForm = this;
    releaseForm.name = $(event.target).parents('.panel').find('.approve-name').val()||
      'Release '+ now.toLocaleDateString();
    releaseForm.comment = $(event.target).parents('.panel').find('.approve-comment').val()
      || 'Approved from obligations report. By ' + ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
      + ', ' + now.toLocaleDateString();
    releaseForm.approved = true;
    updateApprove(user, releaseForm)
  },
  'click .not-approve-project': function (event) {
    const user = Meteor.user();
    const now = new Date();
    let releaseForm = this;
    releaseForm.name = $(event.target).parents('.panel').find('.approve-name').val()||
      'Release '+ now.toLocaleDateString();
    releaseForm.comment = $(event.target).parents('.panel').find('.approve-comment').val()
      || 'Not approved from obligations report. By ' + ((user.profile && user.profile.name)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email))
      + ', ' + now.toLocaleDateString();
    releaseForm.approved = false;
    updateApprove(user, releaseForm)
  },
  'click .go_to_module': function () {
    Meteor.setTimeout(function () {
      $('.select2').trigger('change.select2');
    },1)

  }
};
Template.reportObligations.helpers({
  projectList: function () {
    return Session.get('companyProjects');
  },
  isActiveProject:function () {
    return !Router.current().params.query.moduleId && Router.current().params.query.projectId === this._id
  },
  isActiveModule:function () {
    return Router.current().params.query.moduleId === this._id
  },
  approvalClass: function () {
    let release = _.sortBy(_.filter(this.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse();
    return (release[0] && release[0].approved)?'panel-success':'panel-danger'
  },
  approvalAlertClass: function () {
    let release = _.sortBy(_.filter(this.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse();
    return (release[0] && release[0].approved)?'alert-success':'alert-danger'
  },

  getModuleQuery: function () {
    return {
      projectId:Router.current().params.query.projectId,
      moduleId:this._id
    };
  },

  projectView: function () {
    return !Router.current().params.query.moduleId
  },
  projectModules: function () {
    const projectId = Router.current().params.query.projectId
    if(projectId){
      let modules = Session.get('modulesByProject');
      return _.map(_.filter(modules, (module)=>{
        return (projectId === Projects.UNASSIGNED ? !module.projectId : module.projectId === projectId) && !module.archived
      }), (module)=>{
        return new Module(module)
      });
    }else {
      return []
    }
  },
  projectId: function () {
    return Router.current().params.query.projectId
  },
  moduleId: function () {
    return Router.current().params.query.moduleId
  },
  selectProject: function () {
    return !Router.current().params.query.moduleId && !Router.current().params.query.projectId
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
  getRequirements: function () {
    let project = Projects.findOne(Router.current().params.query.projectId);
    if(project){
      let modules = Session.get('modulesByProject');
      modules = _.filter(modules, (module)=>{
        return module._id === Router.current().params.query.moduleId
      });
      const module = modules && modules[0];
      let settings;
      if(!project.requirements){
        settings = (module)? module.requirements:false;
      }else{
        settings =  (module)? _.extend(project.requirements, module.requirements):project.requirements;
      }
      return settings || false
    }
  },
  getComment: function (comment) {
    return comment || 'Module has no release comments. Click to see more details'
  }
});

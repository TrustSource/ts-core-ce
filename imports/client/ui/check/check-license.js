import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Licenses from '/imports/lib/collections/licenses';
import {$} from 'meteor/jquery';
import _ from 'underscore';

Template.checkLicense.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  $('.select2').select2({width: '100%'});
  Session.set('requestInProgress');
  Session.set('currentLicense');
  Session.set('currentModule');
  Session.set('currentProject');
  Session.set('checkResults');
  $('#currentProject').val('').trigger('change');
  $('#currentModule').val('').trigger('change');
  $('#currentLicense').val('').trigger('change');
  $('#checkLicense').validate({
    rules: {
      currentProject: {
        required: true,
        minlength: 1
      },
      currentModule: {
        required: true,
        minlength: 1
      },
      currentLicense: {
        required: true,
        minlength: 1
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const currentProject = $(form).find('[name=currentProject]').val();
      const currentModule = $(form).find('[name=currentModule]').val();
      const currentLicense = $(form).find('[name=currentLicense]').val();
      let project = Projects.findOne(currentProject);
      let module = Modules.findOne(currentModule);
      if(currentProject && project.legalSettingsValid() && currentModule && module.legalSettingsValid() && currentLicense){
        Session.set('requestInProgress', true);
        let list = [];
        list.push(currentLicense);
        Meteor.callAsync('checkLicense', currentProject, currentModule, list).then(function(data) {
          if (data.length !== 0) {
            let result = {
              list: data,
              currentProject: currentProject,
              currentModule: currentModule,
              currentLicense: currentLicense
            };
            Session.set('checkResults',result);
          } else {
            let textError = 'Error: could not connect to checkLicense service';
            Session.set('checkResults',{error:textError});
          }
        }).catch(function(error) {
          Session.set('checkResults', {error: error.reason || error.message || 'Unknown error'});
        }).finally(function() {
          Session.set('requestInProgress', false);
        });
      }
    }
  });
});

Template.checkLicense.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.checkLicense.events({
  'change #currentProject': function (event) {
    const _id = $(event.target).val();
    Session.set('currentProject',_id);
    Session.set('currentModule');
    $('#currentModule').val('').trigger('change');
  },
  'change #currentModule': function (event) {
    const _id = $(event.target).val();
    Session.set('currentModule',_id)
  },
  'change #currentLicense': function (event) {
    const _id = $(event.target).val();
    Session.set('currentLicense',_id)
  },
  'submit #checkLicense': function (event) {
    event.preventDefault();
  }
});

Template.checkLicense.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  activeTab: function (tab) {
    let state = Router.current().route.getName();
    if (tab instanceof Array) {
      let anyState = _.some(tab, function (obj) {
        return obj === state;
      });
      return anyState ? 'active-tab active' : '';
    } else {
      return tab === state ? 'active-tab active ' : '';
    }
  },
  projects: function () {
    return Projects.find().fetch()
  },
  modules: function () {
    if(Session.get('currentProject')){
      return Modules.find({projectId : Session.get('currentProject')}).fetch()
    }
  },
  licenses: function () {
    return Licenses.find({}, {sort: {name: 1}}).fetch()
  },
  isCurrentProject: function (_id) {
    return Session.get('currentProject') === _id
  },
  isCurrentModule: function (_id) {
    return Session.get('currentModule') === _id
  },
  isCurrentLicense: function (key) {
    return Session.get('currentLicense') === key
  },
  listOfRequired: function () {
    let list = [];
    if(!Session.get('currentProject')){
      list.push('project')
    }
    if(!Session.get('currentModule')){
      list.push('module')
    }
    if(!Session.get('currentLicense')){
      list.push('license')
    }
    return list.join(', ')
  },
  inputDataReady: function () {
    return Session.get('currentLicense') && Session.get('currentModule') && Session.get('currentProject')
  },
  noSettingsInProject: function () {
    let project = Projects.findOne(Session.get('currentProject'));
    return project && !project.legalSettingsValid()
  },
  noSettingsInModule: function () {
    let module = Modules.findOne(Session.get('currentModule'));
    return module && !module.legalSettingsValid()
  },
  getProjectOptions: function () {
    return {
      projectId: Session.get('currentProject')
    };
  },
  getModuleOptions: function () {
    return {
      projectId: Session.get('currentProject'),
      moduleId: Session.get('currentModule')
    };
  },
  checkResults: function () {
    let checkResults = Session.get('checkResults');
    return checkResults && checkResults.list[0]
  },
  checkResultsError: function () {
    let checkResults = Session.get('checkResults');
    return checkResults && checkResults.error
  },
  requestInProgress: function () {
    return Session.get('requestInProgress')
  },
  actualResults: function () {
    let checkResults = Session.get('checkResults');
    return checkResults && checkResults.currentProject === Session.get('currentProject') &&
      checkResults.currentModule === Session.get('currentModule') && checkResults.currentLicense === Session.get('currentLicense')
  },
  actionIsDisabled: function () {
    let project = Projects.findOne(Session.get('currentProject'));
    let module = Modules.findOne(Session.get('currentModule'));
    return (project && !project.legalSettingsValid()) || (module && !module.legalSettingsValid()) ||
       (!Session.get('currentLicense') || !Session.get('currentModule') || !Session.get('currentProject'))
  }
});

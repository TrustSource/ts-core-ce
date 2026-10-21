/* global Typeahead:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Component from '/imports/lib/component/Component';
import ComponentSearch from '/imports/client/ui/lib/ComponentSearch';
import {$} from 'meteor/jquery';
import _ from 'underscore';

Template.checkComponent.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  ComponentSearch.search('');
  this.$('.typeahead').typeahead({
    hint: true,
    minLength: 1,
    highlight: true
  },{
    name: 'components',
    displayKey: 'value',
    valueKey: 'id',
    templates: {
      empty: Typeahead.compile('suggestionNoRecords'),
      suggestion: Typeahead.compile('componentSuggestion')
    },
    limit: 15,
    source: _.debounce(searchComponents, 150)
  });

  this.$('.typeahead').on('typeahead:selected', selectedComponent);
});

let selectedComponent = function (e, payload) {
  let component = payload.component;
  Session.set('currentComponent',{
    'name' : component.getName(),
    'key' : component.getKey(),
    'homepageUrl' : component.getUrl('homepage') || null,
    'repoUrl' : component.getUrl('repo') || null,
    'dependencies' : [],
    'versionsList' : component.data().versions
  });
  Session.set('currentVersion');
  $('#currentVersion').val('').trigger('change');
};

let searchComponents = function (query, callback, asyncResults) {
  Meteor.callAsync(
    'searchComponentsByFields',
    {name: query},
    false,
    {_id:true, name:true, key:true,
      urls: true, versions:true }
  ).then(function(data) {
    asyncResults(data.map(function(it){
      return {value: it.name, component: new Component(it), id: it._id};
    }))
  }).catch(function(error) {
    console.error('searchComponentsByFields failed:', error);
  });
};

Template.checkComponent.onRendered(function () {
  Session.set('requestInProgress');
  Session.set('currentModule');
  Session.set('currentProject');
  Session.set('currentComponent');
  Session.set('currentVersion');
  Session.set('checkResults');
  $('.select2').select2({width: '100%'});
  $('#currentProject').val('').trigger('change');
  $('#currentModule').val('').trigger('change');
  $('#currentVersion').val('').trigger('change');
  $('#checkComponent').validate({
    rules: {
      currentProject: {
        required: true,
        minlength: 1
      },
      currentModule: {
        required: true,
        minlength: 1
      },
      currentComponent: {
        required: true,
        minlength: 1
      },
      currentVersion: {
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
      const currentComponent = Session.get('currentComponent');
      let project = Projects.findOne(currentProject);
      let module = Modules.findOne(currentModule);
      if(currentProject && project.legalSettingsValid() && currentModule && module.legalSettingsValid() && currentComponent){
        Session.set('requestInProgress', true);
        let list = [];
        list.push(currentComponent);
        Meteor.callAsync('checkComponent', currentProject, currentModule, list).then(function(data) {
          if (data.length !== 0) {
            let result = {
              list: data,
              currentProject: currentProject,
              currentModule: currentModule,
              currentComponent: currentComponent
            };
            Session.set('checkResults', result);
          } else {
            let textError = 'Error: could not connect to checkComponent service';
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

Template.checkComponent.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.checkComponent.events({
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
  'change #currentVersion': function (event) {
    const version = $(event.target).val();
    Session.set('currentVersion',version);
    let versionObject = Session.get('currentComponent').versionsList.find(function (versionItem) {
      return versionItem.version === version
    });
    if(versionObject){
      let licenses = _.map(versionObject.licenses,function (license) {
        return {
          'name':license.key,
          'key':license.key
        }
      });
      let component = Session.get('currentComponent');
      component.licenses = licenses || [];
      component.versions = [version];
      Session.set('currentComponent',component);
    }
  },
  'submit #checkComponents': function (event) {
    event.preventDefault();
  }
});

Template.checkComponent.helpers({
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
    }else {
      return []
    }
  },
  isCurrentProject: function (_id) {
    return Session.get('currentProject') === _id
  },
  isCurrentModule: function (_id) {
    return Session.get('currentModule') === _id
  },
  listOfRequired: function () {
    let list = [];
    if(!Session.get('currentProject')){
      list.push('project')
    }
    if(!Session.get('currentModule')){
      list.push('module')
    }
    if(!Session.get('currentComponent')){
      list.push('component')
    }
    if(!Session.get('currentVersion')){
      list.push('version')
    }
    return list.join(', ')
  },
  inputDataReady: function () {
    return Session.get('currentComponent') && Session.get('currentModule') && Session.get('currentProject')
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
      checkResults.currentModule === Session.get('currentModule') && checkResults.currentComponent &&
      checkResults.currentComponent.key === Session.get('currentComponent').key
  },
  actionIsDisabled: function () {
    let project = Projects.findOne(Session.get('currentProject'));
    let module = Modules.findOne(Session.get('currentModule'));
    return (project && !project.legalSettingsValid()) || (module && !module.legalSettingsValid()) ||
      (!Session.get('currentComponent') || !Session.get('currentModule') || !Session.get('currentProject'))
  },
  getType: function () {
    let status = this.type;
    return status ? {
      key:status+'s',
      text:status[0].toUpperCase()+status.substr(1,status.length)
    }: null
  },

  currentComponent: function () {
    return Session.get('currentComponent')
  },

  versions: function () {
    let component = Session.get('currentComponent');
    return component ? component.versionsList : []
  },

  isCurrentVersion: function (version) {
    let component = Session.get('currentVersion');
    return component === version
  },

  getLicenses: function () {
    let licenses = this.licenses || [];
    licenses =  licenses.map(function (license) {
      return license.key
    });
    return licenses.join(', ')
  }
});

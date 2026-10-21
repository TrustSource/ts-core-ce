import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {AutoForm} from 'meteor/aldeed:autoform';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {CIARequirementsSchema} from '/imports/lib/schemas/CIARequirementsSchema';

function validateForm() {
  Meteor.setTimeout(() => {
    if($('#updateModuleFormCIARequirements').length){
      AutoForm.validateForm('updateModuleFormCIARequirements');
    }
  }, 300);
}

Template.moduleSettingsCIA.onRendered(function () {
  validateForm();
});

Template.moduleSettingsCIA.events({

  'click .copy-cia-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    const srcModule = Modules.findOne({_id: event.target.id}, {fields: {name: 1, ciaRequirements: 1}});
    if (srcModule) {
      Meteor.callAsync('Modules.UpdateCiaRequirements', module._id, srcModule.ciaRequirements).then(function () {
        Notify.success('CIA requirements copied from: ' + (srcModule.name));
        validateForm();
      }).catch(function (error) {
        console.log('Update problem: ', error);
      });
    }
  }
});

Template.moduleSettingsCIA.helpers({

  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  getCIASuggestions: function () {
    const array = Modules.find(
      {_id: {$ne: this._id}, ciaRequirements: {$exists: true}, name: {$exists: true}}).fetch();
    return _.filter(array, m => m.ciaSettingsValid());
  },

  getRequirements: function () {
    return this.ciaRequirements || {};
  },

  getProject: function () {
    return Projects.findOne(this.projectId);
  },

  getProjectRequirements: function () {
    const project = Projects.findOne(this.projectId);
    return project && project.ciaRequirements || {};
  },

  noProjectRequirements: function () {
    const project = Projects.findOne(this.projectId);
    return project && (!project.ciaRequirements || Object.keys(project.ciaRequirements).length === 0);
  },

  getProjects() {
    return Projects;
  },

  getModules() {
    return Modules;
  },

  getRequirementsSchema() {
    return CIARequirementsSchema;
  },

  getProjectRequirementsSchema() {
    return CIARequirementsSchema;
  }

});

AutoForm.hooks({
  updateModuleFormCIARequirements: {
    onSubmit: function (insertDoc) {
      let self = this;
      try {
        const formContext = Template.currentData();
        const module = Modules.findOne(Router.current().params.moduleId,{fields:{name:true}});
        Meteor.callAsync('Modules.UpdateCiaRequirements', formContext.docId, insertDoc).then(function () {
          const user = Meteor.user();
          Notify.success('CIA requirements changed!');
          Meteor.callAsync('logEvent', user, 'Module '+module.name+' CIA settings changed', 'moduleCIASettingsUpdated');
          self.done();
        }).catch(function (error) {
          const user = Meteor.user();
          Notify.danger('Internal Error! CIA requirements not changed: '+error.message);
          Meteor.callAsync('logEvent', user, error.message, 'moduleCIASettingsUpdated');
          self.done(new Error('Submission failed'));
        });
      } catch (error) {   // catch errors and prevent default submit handling by returning false in every case
        console.log('Error in onSubmit()', error);
        self.done(new Error('Submission failed'));
      }
      return false;
    },
    onError: function () {
      console.log('updateModuleFormCIARequirements-onError: ', arguments);
    }
  }
});

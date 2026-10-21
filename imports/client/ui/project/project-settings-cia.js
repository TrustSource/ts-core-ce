import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {AutoForm} from 'meteor/aldeed:autoform';
import Projects from '/imports/lib/collections/projects';
import Notify from '/imports/api/notify';
import {CIARequirementsSchema} from '/imports/lib/schemas/CIARequirementsSchema';

function validateForm() {
  Meteor.setTimeout(() => {
    if($('#updateProjectFormCIARequirements').length){
      AutoForm.validateForm('updateProjectFormCIARequirements');
    }
  }, 300);
}

Template.projectSettingsCIA.onRendered(function () {
  validateForm();
});

Template.projectSettingsCIA.events({

  'click .copy-cia-settings': function (event) {
    event.preventDefault();
    const project = Template.currentData();
    const srcProject = Projects.findOne({_id: event.target.id}, {fields: {name: 1, ciaRequirements: 1}});
    if (srcProject) {
      Meteor.callAsync('Projects.UpdateCiaRequirements', project._id, srcProject.ciaRequirements).then(function () {
        Notify.success('CIA requirements copied from: ' + (srcProject.name));
        validateForm();
      }).catch(function (error) {
        console.log('Update problem: ', error);
      });
    }
  }
});

Template.projectSettingsCIA.helpers({

  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },

  getCIASuggestions: function () {
    const array = Projects.find(
      {_id: {$ne: this._id}, ciaRequirements: {$exists: true}, name: {$exists: true}}).fetch();
    return _.filter(array, m => m.ciaSettingsValid());
  },

  getRequirements: function () {
    return this.ciaRequirements || {};
  },

  getProjects() {
    return Projects;
  },

  getRequirementsSchema() {
    return CIARequirementsSchema;
  }

});

AutoForm.hooks({
  updateProjectFormCIARequirements: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      const project = Projects.findOne(Router.current().params.projectId,{fields:{name:true}});
      Meteor.callAsync('Projects.UpdateCiaRequirements', formContext.docId, insertDoc).then(function () {
        const user = Meteor.user();
        Notify.success('CIA requirements changed!');
        Meteor.callAsync('logEvent', user, 'Project '+project.name+' CIA settings changed', 'projectCIASettingsUpdated');
        self.done();
      }).catch(function (error) {
        console.log('Error in onSubmit()', error);
        const user = Meteor.user();
        Notify.danger('Internal Error! CIA requirements not changed: ');
        Meteor.callAsync('logEvent', user, error.message, 'projectCIASettingsUpdated');
        self.done(new Error('Submission failed'));
      });
      return false;
    },
    onError: function () {
      console.log('updateProjectFormCIARequirements-onError: ', arguments);
    }
  }
});

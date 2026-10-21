import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {AutoForm} from 'meteor/aldeed:autoform';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import RequirementsHistory from '/imports/lib/collections/requirementsHistory';
import Notify from '/imports/api/notify';
import {RequirementsSchema, QuestionnaireSchemaStepOne, QuestionnaireSchemaStepTwo, QuestionnaireSchemaStepThree}
  from '/imports/lib/schemas/requirementsModuleSchema';

const UPDATE_PROBLEM = 'Update problem: '

function validateForm() {
  Meteor.setTimeout(() => {
    if($('#updateModuleFormRequirements').length){
      AutoForm.validateForm('updateModuleFormRequirements');
    }
  }, 300);
}

Template.moduleSettingsLegal.onRendered(function () {
  const module = Modules.findOne(this.data && this.data._id || this._id); // get a reactive datasource
  Session.set('legalWizard', module && !module.legalSettingsValid() || false);
  Session.set('importFilter');
  Session.set('moduleFilter');
  Session.set('legalHistory');
  validateForm();
});

Template.moduleSettingsLegal.events({

  'click .copy-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    const srcModule = Modules.findOne({_id: event.target.id}, {fields: {name: 1, requirements: 1}});
    if (srcModule) {
      Meteor.callAsync('Modules.UpdateRequirements', module._id, srcModule.requirements, true).then(function () {
        Session.set('legalWizard', false);
        Notify.success('Legal settings copied from: ' + (srcModule.name));
        validateForm();
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
        Notify.danger(error.message || 'Failed to copy legal settings');
      });
    }
  },
  'click .copy-legal-template-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    const srcModule = LegalSettingsTemplates.findOne({_id: event.target.id}, {fields: {name: 1, requirements: 1}});
    if (srcModule) {
      Meteor.callAsync('Modules.UpdateRequirements', module._id, srcModule.requirements, true).then(function () {
        Session.set('legalWizard', false);
        Notify.success('Legal settings copied from: ' + (srcModule.name));
        validateForm();
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
        Notify.danger(error.message || 'Failed to copy legal settings');
      });
    }
  },
  'click .propagate-all-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync('bulkUpdateModuleLegalSettings', module._id, module.requirements).then(function() {
        Notify.success('Legal settings propagated to all modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-all-my-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync('bulkUpdateMyModuleLegalSettings', module._id, module.requirements).then(function() {
        Notify.success('Legal settings propagated to all my modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-project-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync(
        'bulkUpdateProjectModuleLegalSettings',
        module._id,
        module.projectId,
        module.requirements
      ).then(function() {
        Notify.success('Legal settings propagated to all project modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-my-project-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync(
        'bulkUpdateMyProjectModuleLegalSettings',
        module._id,
        module.projectId,
        module.requirements
      ).then(function() {
        Notify.success('Legal settings propagated to all my project modules');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-legal-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    if (module) {
      Meteor.callAsync('Modules.UpdateRequirements', event.target.id, module.requirements, false).then(function () {
        Notify.success('Legal settings propagated to module');
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
        Notify.danger(error.message || 'Failed to propagate legal settings');
      });
    }
  },
  'click .actions-wizard .view-history': function (event) {
    event.preventDefault();
    Session.set('legalHistory', true);
  },
  'click .actions-wizard .close-history': function (event) {
    event.preventDefault();
    Session.set('legalHistory', false);
    validateForm();
  },
  'click .actions-wizard .view-wizard': function (event) {
    event.preventDefault();
    Session.set('legalWizard', true);
    validateForm();
  },
  'click .actions-wizard .view-all': function (event) {
    event.preventDefault();
    Session.set('legalWizard', false);
    validateForm();
  },
  'input .import_filter': function (event) {
    Session.set('importFilter', $(event.target).val())
  },
  'input .module_filter': function (event) {
    Session.set('moduleFilter', $(event.target).val())
  }
});

Template.moduleSettingsLegal.helpers({
  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  getLegalSettings: function () {
    const array = Modules.find(
      {_id: {$ne: this._id}, requirements: {$exists: true}, name: {$exists: true}}).fetch();
    return _.filter(array, m => m.legalSettingsValid());
  },

  getLegalTemplatesSettings: function () {
    return LegalSettingsTemplates.find({requirements: {$exists: true}, name: {$exists: true}}).fetch();
  },

  historyView: function () {
    return Session.get('legalHistory');
  },

  historyRequirements: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    let filter = {
      moduleId: Router.current().params.moduleId,
      companyId
    }
    return RequirementsHistory.find(filter, {sort: {created: -1}}).fetch();
  },

  otherModules: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Modules.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  myModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Modules.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  projectModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const module = Template.currentData();
    return Modules.find({
      $and: [
        {_id: {$ne: module._id}},
        { projectId: module.projectId },
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.members': { $exists: false }},
          {'relatedUsers.members': []},
          {'relatedUsers.members': user._id},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  myProjectModulesCount: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    const module = Template.currentData();
    return Modules.find({
      $and: [
        {_id: {$ne: module._id}},
        { projectId: module.projectId },
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).count()
  },

  filterList: function (list, filter) {
    return _.filter(list, m => {
      return m.getName().toLowerCase().indexOf(filter.toLowerCase()) > -1
    }).slice(0, 9);
  },

  getImportFilter: function () {
    return Session.get('importFilter') || '';
  },

  getModuleFilter: function () {
    return Session.get('moduleFilter') || '';
  },

  getRequirements: function () {
    return this.requirements || {};
  },

  getProject: function () {
    return Projects.findOne(this.projectId);
  },

  getProjectRequirements: function () {
    const project = Projects.findOne(this.projectId);
    return project && project.requirements || {};
  },

  noProjectRequirements: function () {
    const project = Projects.findOne(this.projectId);
    return project && (!project.requirements || Object.keys(project.requirements).length === 0);
  },

  getProjects() {
    return Projects;
  },

  getModules() {
    return Modules;
  },

  getRequirementsSchema() {
    return RequirementsSchema;
  },

  wizardView: function () {
    return Session.get('legalWizard');
  },

  wizardBtnClass: function (wizard) {
    let wname;
    if (wizard) {
      wname = Session.get('legalWizard') ? 'hidden' : '';
    } else {
      wname = !Session.get('legalWizard') ? 'hidden' : '';
    }
    return wname;
  },

  stepsQuestionnaire: function () {
    // The stored answers, so every question starts with the saved choice selected.
    // (`this.getRequirements` named a helper, not a field, and was undefined.)
    const requirements = Object.assign({}, this.requirements);
    return [{
      id: '1',
      title: 'Question 1',
      template: 'moduleQuestionnaireStepOne',
      formId: 'questionnaire-step-one-form',
      schema: QuestionnaireSchemaStepOne,
      data: requirements,
      onSubmit: function (data, wizard) {
        wizard.setData('1', data);
        wizard.next();
      }
    }, {
      id: '2',
      title: 'Question 2',
      template: 'moduleQuestionnaireStepTwo',
      formId: 'questionnaire-step-two-form',
      schema: QuestionnaireSchemaStepTwo,
      data: requirements,
      onSubmit: function (data, wizard) {
        wizard.setData('2', data);
        wizard.next();
      }
    }, {
      id: '3',
      title: 'Question 3',
      template: 'moduleQuestionnaireStepThree',
      formId: 'questionnaire-step-three-form',
      schema: QuestionnaireSchemaStepThree,
      data: requirements,
      onSubmit: function (data, wizard) {
        wizard.setData('3', data);
        pushLegalSettings(wizard, this);
      }
    }]
  }

});

function pushLegalSettings(wizard, that) {
  const moduleId = Router.current().params.moduleId;
  const module = Modules.findOne(moduleId, {fields: {name: true}});
  Meteor.callAsync('Modules.UpdateRequirements', moduleId, wizard.mergedData(), true).then(function () {
    const user = Meteor.user();
    Session.set('legalWizard', false);
    Notify.success('Legal settings changed!');
    Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' legal settings changed', 'moduleLegalSettingsUpdated');
    const newUrl = Router.current().route.path(Router.current().params, {});
    Router.go(newUrl);
    validateForm();
    that.done();
  }).catch(function (error) {
    const user = Meteor.user();
    Notify.danger('Internal Error! Legal settings not changed.');
    Meteor.callAsync('logEvent', user, error.message, 'moduleLegalSettingsUpdated');
    that.done(new Error('Submission failed'));
  });
}

AutoForm.hooks({
  updateModuleFormRequirements: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      const module = Modules.findOne(Router.current().params.moduleId, {fields: {name: true}});
      Meteor.callAsync('Modules.UpdateRequirements', formContext.docId, insertDoc, true).then(function () {
        const user = Meteor.user();
        Notify.success('Legal settings changed!');
        Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' legal settings changed', 'moduleLegalSettingsUpdated');
        self.done();
      }).catch(function (error) {
        const user = Meteor.user();
        Notify.danger('Internal Error! Legal settings not changed.');
        Meteor.callAsync('logEvent', user, error.message, 'moduleLegalSettingsUpdated');
        self.done(new Error('Submission failed'));
      });
      return false;
    },
    onError: function (formType, error) {
      if (error && error.message) {
        Notify.danger(error.message);
      }
    }
  }
});

Template.moduleQuestionnaireStepOne.helpers({
  getModules() {
    return Modules;
  }
});

Template.moduleQuestionnaireStepTwo.helpers({
  getModules() {
    return Modules;
  }
});

Template.moduleQuestionnaireStepThree.helpers({
  getModules() {
    return Modules;
  }
});

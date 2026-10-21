import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {AutoForm} from 'meteor/aldeed:autoform';
import 'meteor/forwarder:autoform-wizard';
import Projects from '/imports/lib/collections/projects';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import RequirementsHistory from '/imports/lib/collections/requirementsHistory';
import Notify from '/imports/api/notify';
import {RequirementsSchema, QuestionnaireSchemaStepOne,
  QuestionnaireSchemaStepTwo, QuestionnaireSchemaStepThree}
  from '/imports/lib/schemas/requirementsProjectSchema';

const UPDATE_PROBLEM = 'Update problem: '

function validateForm() {
  Meteor.setTimeout(() => {
    if($('#updateFormRequirements').length){
      AutoForm.validateForm('updateFormRequirements');
    }
  }, 300);
}

Template.projectSettingsLegal.onRendered(function () {
  const project = Projects.findOne(this.data._id||this._id); // get a reactive datasource
  Session.set('legalWizard', project && !project.legalSettingsValid() || false);
  Session.set('importFilter');
  Session.set('projectFilter');
  Session.set('legalHistory');
  validateForm();
});

Template.projectSettingsLegal.events({

  'click .copy-legal-settings': function (event) {
    event.preventDefault();
    const project = Template.currentData();
    const srcModule = Projects.findOne({_id: event.target.id}, {fields: {name: 1, requirements: 1}});
    if (srcModule) {
      Meteor.callAsync('Projects.UpdateRequirements', project._id, srcModule.requirements).then(function () {
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
    const project = Template.currentData();
    const srcModule = LegalSettingsTemplates.findOne({_id: event.target.id}, {fields: {name: 1, requirements: 1}});
    if (srcModule) {
      Meteor.callAsync('Projects.UpdateRequirements', project._id, srcModule.requirements).then(function () {
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
    const project = Template.currentData();
    if (project) {
      Meteor.callAsync('bulkUpdateProjectLegalSettings', project._id, project.requirements).then(function() {
        Notify.success('Legal settings propagated to all projects');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-all-my-legal-settings': function (event) {
    event.preventDefault();
    const project = Template.currentData();
    if (project) {
      Meteor.callAsync('bulkUpdateMyProjectLegalSettings', project._id, project.requirements).then(function() {
        Notify.success('Legal settings propagated to all my projects');
      }).catch(function(error) {
        if (error) {
          console.log(UPDATE_PROBLEM, error);
        }
      });
    }
  },
  'click .propagate-legal-settings': function (event) {
    event.preventDefault();
    const project = Template.currentData();
    if (project) {
      Meteor.callAsync('Projects.UpdateRequirements', event.target.id, project.requirements).then(function () {
        Notify.success('Legal settings propagated to project');
      }).catch(function (error) {
        console.log(UPDATE_PROBLEM, error);
        Notify.danger(error.message || 'Failed to propagate legal settings');
      });
    }
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
  'input .project_filter': function (event) {
    Session.set('projectFilter', $(event.target).val())
  },
  'click .actions-wizard .view-history': function (event) {
    event.preventDefault();
    Session.set('legalHistory', true);
  },
  'click .actions-wizard .close-history': function (event) {
    event.preventDefault();
    Session.set('legalHistory', false);
    validateForm();
  }
});

Template.projectSettingsLegal.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },

  getLegalSettings: function () {
    const array = Projects.find(
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
      projectId: Router.current().params.projectId,
      companyId
    }
    return RequirementsHistory.find(filter, {sort: {created: -1}}).fetch();
  },

  otherProjects: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Projects.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers': { $exists: false }},
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  myProjects: function () {
    const user = Meteor.user();
    const companyId = user.profile.companyId;
    return Projects.find({
      $and: [
        {_id: {$ne: this._id}},
        { companyId: companyId },
        { name: {$exists: true}},
        { $or: [
          {'relatedUsers.defaultProjectManager': user._id},
          {'relatedUsers.defaultComplianceManager': user._id}
        ]}
      ]}).fetch()
  },

  filterList: function (list, filter) {
    return _.filter(list, m => {
      return m.getName().toLowerCase().indexOf(filter.toLowerCase()) > -1
    }).slice(0, 9);
  },

  getImportFilter: function () {
    return Session.get('importFilter') || '';
  },

  getProjectFilter: function () {
    return Session.get('projectFilter') || '';
  },

  getRequirements: function () {
    const req = this.requirements || {};
    if (!req.targetMarket || req.targetMarket[0] !== 'GERMANY') {
      req.targetMarket = ['GERMANY'];
    }
    return req;
  },

  getProjects() {
    return Projects;
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
      template: 'questionnaireStepOne',
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
      template: 'questionnaireStepTwo',
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
      template: 'questionnaireStepThree',
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
  const projectId = Router.current().params.projectId;
  const project = Projects.findOne(projectId, {fields: {name: true}});
  Meteor.callAsync('Projects.UpdateRequirements', projectId, wizard.mergedData()).then(function () {
    const user = Meteor.user();
    Session.set('legalWizard', false);
    Notify.success('Legal settings changed!');
    Meteor.callAsync('logEvent', user, 'Project ' + project.name + ' legal settings changed', 'projectLegalSettingsUpdated');
    const newUrl = Router.current().route.path(Router.current().params, {});
    Router.go(newUrl);
    validateForm();
    that.done();
  }).catch(function (error) {
    const user = Meteor.user();
    Notify.danger('Internal Error! Legal settings not changed.');
    Meteor.callAsync('logEvent', user, error.message, 'projectLegalSettingsUpdated');
    that.done(new Error('Submission failed'));
  });
}

AutoForm.hooks({
  updateFormRequirements: {
    onSubmit: function (insertDoc) {
      let self = this;
      const formContext = Template.currentData();
      const project = Projects.findOne(Router.current().params.projectId, {fields: {name: true}});
      Meteor.callAsync('Projects.UpdateRequirements', formContext.docId, insertDoc).then(function () {
        const user = Meteor.user();
        Notify.success('Legal settings changed!');
        Meteor.callAsync('logEvent', user, 'Project ' + project.name + ' legal settings changed', 'projectLegalSettingsUpdated');
        self.done();
      }).catch(function (error) {
        const user = Meteor.user();
        Notify.danger('Internal Error! Legal settings not changed.');
        Meteor.callAsync('logEvent', user, error.message, 'projectLegalSettingsUpdated');
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

Template.questionnaireStepOne.helpers({
  getProjects() {
    return Projects;
  }
});

Template.questionnaireStepTwo.helpers({
  getProjects() {
    return Projects;
  }
});

Template.questionnaireStepThree.helpers({
  getProjects() {
    return Projects;
  }
});

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {AutoForm} from 'meteor/aldeed:autoform';
import LegalSettingsTemplates from '/imports/lib/collections/legalSettingsTemplates';
import Notify from '/imports/api/notify';
import {RequirementsSchema, QuestionnaireSchemaStepOne,
  QuestionnaireSchemaStepTwo, QuestionnaireSchemaStepThree}
  from '/imports/lib/schemas/requirementsProjectSchema';

function validateForm() {
  Meteor.setTimeout(() => {
    if($('#updateFormCompanyProjectTemplateRequirements').length){
      AutoForm.validateForm('updateFormCompanyProjectTemplateRequirements');
    }
  }, 300);
}

Template.companyLegalTemplatesDetailsProject.onRendered(function () {
  Session.set('legalWizard', false);
  validateForm();
});

Template.companyLegalTemplatesDetailsProject.events({
  'click .actions-wizard .view-wizard': function (event) {
    event.preventDefault();
    Session.set('legalWizard', true);
    validateForm();
  },
  'click .actions-wizard .view-all': function (event) {
    event.preventDefault();
    Session.set('legalWizard', false);
    validateForm();
  }
});

Template.companyLegalTemplatesDetailsProject.helpers({
  getRequirements: function () {
    return this.requirements || {};
  },

  getProjects() {
    return LegalSettingsTemplates;
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
  try {
    const formContext = Template.currentData();
    const requirements = wizard.mergedData();
    Meteor.callAsync(
      '_updateCompanyLegalSettingsTemplate',
      {$set: {requirements}},
      formContext.docId
    ).then(function() {
      Notify.success('Legal settings changed!');
      Session.set('legalWizard', false);
      const newUrl = Router.current().route.path(Router.current().params, {});
      Router.go(newUrl);
      validateForm();
    }).catch(function(_error) {
      Notify.danger('Internal Error! Legal settings not changed: ');
    });
    that.done();
  } catch (error) {
    console.log('Error in onSubmit()', error);
    that.done(new Error('Submission failed'));
  }
}

AutoForm.hooks({
  updateFormCompanyProjectTemplateRequirements: {
    onSubmit: function (insertDoc) {
      try {
        const formContext = Template.currentData();
        const requirements = insertDoc;
        Meteor.callAsync(
          '_updateCompanyLegalSettingsTemplate',
          {$set: {requirements}},
          formContext.docId
        ).then(function() {
          Notify.success('Legal settings changed!');
        }).catch(function(_error) {
          Notify.danger('Internal Error! Legal settings not changed: ');
        });
        this.done();
      } catch (error) {   // catch errors and prevent default submit handling by returning false in every case
        console.log('Error in onSubmit()', error);
        this.done(new Error('Submission failed'));
      }
      return false;
    },
    onError: function () {
      console.log('updateFormCompanyProjectTemplateRequirements-onError: ', arguments);
    }
  }
});

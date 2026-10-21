/* global document:false */

import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {AutoForm} from 'meteor/aldeed:autoform';

Template.questionnaireSteps.events({
  'click .wizardStep.complete': function (event) {
    event.preventDefault();
    this.wizard.show(this.id);
  }
});

Template.questionnaireSteps.helpers({
  xs: function () {
    if ($(document).width() < 768) {
      return true;
    }
  },
  activeStepClass: function (id) {
    let activeStep = this.wizard._activeStepId;
    return (activeStep && activeStep == id) && 'active' || '';
  },
  completeStepClass: function (id) {
    let activeStep = this.wizard._activeStepId;
    if (+id < +activeStep) {
      return 'complete';
    }
    return '';
  },
  activeStep: function () {
    let activeStep = this.wizard._activeStepId;
    return activeStep && Template[activeStep.template] || null;
  },
  badgeStatus: function (id) {
    let activeStep = this.wizard._activeStepId;
    if (activeStep && activeStep == id) {
      return 'badge-primary';
    }
    if (+id < +activeStep) {
      return 'badge-success';
    }
    return '';
  },
  stepNumber: function (id) {
    return $.inArray(id, this.wizard._stepsByIndex) + 1;
  }
});

Template.questionnaireButtons.events({
  'click .wizard-back-button': function (event) {
    event.preventDefault();
    this.previous(AutoForm.getFormValues(this.activeStep(false).formId).insertDoc);
  }
});

Template.questionnaireButtons.helpers({
  showBackButton: function () {
    return this.backButton && !this.isFirstStep();
  }
});
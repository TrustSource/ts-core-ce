import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { AutoForm } from 'meteor/aldeed:autoform';
import './wizard.html';

Template.wizard.onCreated(function () {
  var self = this;
  var steps = self.data.steps || [];

  self._activeStepIndex = new ReactiveVar(0);
  self._stepData = {};

  // Build step index arrays matching original API
  self._stepIds = steps.map(function (s) { return s.id; });

  // Build wizard API object that matches the original forwarder:autoform-wizard contract.
  // Step templates and questionnaireSteps/questionnaireButtons access this via `this.wizard`.
  self._wizard = {
    _activeStepId: null, // updated reactively in helpers
    _stepsByIndex: self._stepIds,
    steps: steps,

    show: function (stepId) {
      var idx = self._stepIds.indexOf(stepId);
      if (idx >= 0) {
        self._activeStepIndex.set(idx);
      }
    },

    next: function () {
      var idx = self._activeStepIndex.get();
      if (idx < steps.length - 1) {
        self._activeStepIndex.set(idx + 1);
      }
    },

    previous: function (currentData) {
      var idx = self._activeStepIndex.get();
      var stepId = self._stepIds[idx];
      if (currentData && stepId) {
        self._stepData[stepId] = currentData;
      }
      if (idx > 0) {
        self._activeStepIndex.set(idx - 1);
      }
    },

    isFirstStep: function () {
      return self._activeStepIndex.get() === 0;
    },

    isLastStep: function () {
      return self._activeStepIndex.get() === steps.length - 1;
    },

    activeStep: function (reactive) {
      var idx = (reactive === false) ? self._activeStepIndex.curValue : self._activeStepIndex.get();
      return steps[idx] || null;
    },

    setData: function (stepId, data) {
      self._stepData[stepId] = data;
    },

    mergedData: function () {
      var merged = {};
      Object.keys(self._stepData).forEach(function (key) {
        Object.assign(merged, self._stepData[key]);
      });
      return merged;
    },

    // Pass through config from the wizard invocation
    backButton: self.data.backButton || 'Back',
    nextButton: self.data.nextButton || 'Next',
    confirmButton: self.data.confirmButton || 'Confirm'
  };
});

Template.wizard.onRendered(function () {
  var self = this;
  var steps = self.data.steps || [];

  // Register autoForm hooks for each step's formId
  var hooks = {};
  steps.forEach(function (step) {
    hooks[step.formId] = {
      onSubmit: function (insertDoc) {
        this.event.preventDefault();
        if (step.onSubmit) {
          step.onSubmit.call(this, insertDoc, self._wizard);
        }
        this.done();
        return false;
      }
    };
  });
  AutoForm.hooks(hooks);
});

Template.wizard.onDestroyed(function () {
  if (this.data.clearOnDestroy) {
    this._stepData = {};
  }
});

Template.wizard.helpers({
  // Data for the stepsTemplate (e.g., questionnaireSteps)
  stepsTemplateData: function () {
    var tpl = Template.instance();
    var idx = tpl._activeStepIndex.get();
    var activeStepId = tpl._stepIds[idx];

    // Update _activeStepId so helpers can read it
    tpl._wizard._activeStepId = activeStepId;

    // Build steps array where each item has a `wizard` reference,
    // so {{#each wizard.steps}} items can access this.wizard in helpers
    var wizardRef = tpl._wizard;
    var stepsWithWizard = (this.steps || []).map(function (step) {
      return {
        id: step.id,
        title: step.title,
        template: step.template,
        formId: step.formId,
        schema: step.schema,
        data: step.data,
        wizard: wizardRef
      };
    });

    // Replace steps on wizard with the enriched array
    wizardRef.steps = stepsWithWizard;

    return {
      wizard: wizardRef
    };
  },

  // Fallback step list when no stepsTemplate is provided
  wizardSteps: function () {
    var tpl = Template.instance();
    var currentIndex = tpl._activeStepIndex.get();
    return (this.steps || []).map(function (step, index) {
      return {
        id: step.id,
        title: step.title,
        stepClass: index === currentIndex ? 'active' : (index < currentIndex ? 'completed' : '')
      };
    });
  },

  // Active step data for rendering the step template
  activeStep: function () {
    var tpl = Template.instance();
    var idx = tpl._activeStepIndex.get();
    var steps = this.steps || [];
    var step = steps[idx];
    if (!step) return null;

    return {
      template: step.template,
      stepContext: {
        step: step,
        wizard: tpl._wizard,
        // Also spread wizard nav properties so questionnaireButtons helpers work
        backButton: tpl._wizard.backButton,
        nextButton: tpl._wizard.nextButton,
        confirmButton: tpl._wizard.confirmButton,
        isFirstStep: tpl._wizard.isFirstStep,
        isLastStep: tpl._wizard.isLastStep,
        previous: tpl._wizard.previous,
        activeStep: tpl._wizard.activeStep
      }
    };
  }
});

Template.wizard.events({
  'click .wizard-back-button': function (event, tpl) {
    event.preventDefault();
    tpl._wizard.previous();
  },
  'click .wizard-step-link': function (event, tpl) {
    event.preventDefault();
    var stepId = event.currentTarget.dataset.step;
    tpl._wizard.show(stepId);
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import TestImportsCreate from '/imports/lib/interactors/testImports/create';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';
import {SarifSchema} from '/imports/lib/schemas/import/sarifSchema';

const FORM = '#TestImportForm'
const MODAL = '#TestImportModal'
const LOADING = 'loadingInProgress'

// AC30: the upload already succeeded, so this is fire-and-forget - a
// risk-register failure must not turn a stored document into an error the user
// sees. Hoisted to module level rather than inlined in the upload callback,
// which already sits at the sonarjs/no-nested-functions depth limit.
function reconcileCweRisks(moduleId, tests) {
  Meteor.callAsync('RiskProperties.ReconcileFromSarif', moduleId, tests)
    .then(function (result) {
      // The caps on created risks are reported, not applied silently.
      if (result && result.limitMessage) {
        Notify.warn(result.limitMessage);
      }
    })
    .catch(function (error) {
      console.warn('CWE risk reconcile failed -', (error && error.reason) || error);
    });
}

Template.TestImportModal.onCreated(function () {
  this.currentUpload = new ReactiveVar(false);
  this.uploadType = new ReactiveVar('sarif');
});

Template.TestImportModal.onRendered(function () {});

Template.TestImportModal.events({});

$(document).on('change', '#TestImportModal input[name=file]', function (event) {
  $(event.target).closest('.input-group-file').find('input[name=filename]').val(event.target.files[0] ? event.target.files[0].name : '');
});

$(document).on('show.bs.modal', '#TestImportModal', function () {
  const form = $(FORM);
  if (form.data('validator')) form.validate().resetForm();
  $(this).find('[name=filename]').val('');
  $(this).find('[name=file]').val('').removeClass('error');
});

$(document).on('shown.bs.modal', '#TestImportModal', function () {
  const form = $(FORM);
  if (form.length) {
    form.validate({
      rules: { file: { required: true } },
      errorElement: 'span',
      errorPlacement: function (error, element) {
        $(element).closest('form').find('label[for="' + element.attr('id') + '"]').append(error);
      },
      submitHandler: function (form) {
        Session.set(LOADING, true)
        const moduleId = Router.current().params.moduleId;
        const analysis = Session.get('moduleAnalysis');
        const analysisId = Router.current().params.query.analysis || (analysis && analysis[0] && analysis[0]._id);
        const scanId = Router.current().params.query.analysis ? null : analysis && analysis[0] && analysis[0].scanId;
        const file = $(form).find('[name=file]')[0].files[0];
        const validExtensions = ['.sarif', '.json'];
        const fileExtension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!validExtensions.includes(fileExtension)) {
          Notify.danger('Invalid file type. Please upload a SARIF (.sarif or .json) file.');
          Session.set(LOADING)
          return;
        }
        const reader = new FileReader();
        reader.onload = function(event) {
          let file = event.target.result
          if(!Utils.isJsonString(file)) {
            Notify.danger('Invalid file content. Please upload a SARIF (.sarif or .json) file.');
            Session.set(LOADING)
            return;
          }
          let fileJson = JSON.parse(file)
          delete fileJson.$schema
          SarifSchema.clean(fileJson, {mutate: true});
          let context = SarifSchema.newContext();
          context.validate(fileJson);
          if (!context.isValid()) {
            context.__errorObject = 'Sarif:';
            let errorText = []
            const keys = typeof context.validationErrors === 'function' ? context.validationErrors() : context.invalidKeys();
            if (keys instanceof Array) {
              keys.forEach(function (key) {
                const msg = context.keyErrorMessage(key.name);
                errorText.push(msg);
              });
            }
            Notify.danger(errorText.join('; '));
            Session.set(LOADING)
            return;
          }
          try {
            TestImportsCreate({moduleId, analysisId, scanId, file: fileJson, type: 'sarif'}, function (tests) {
              Notify.success('File successfully uploaded.');
              $(MODAL).modal('hide');
              Session.set(LOADING);
              reconcileCweRisks(moduleId, tests);
            });
          } catch (error) {
            const message = 'Error: ' + (error.reason || ' could not upload file');
            Notify.danger(message);
            Session.set(LOADING);
          }
        };
        reader.readAsText(file);
      }
    });
  }
});

Template.TestImportModal.helpers({
  currentUpload() {
    return Template.instance().currentUpload.get();
  },
  loading: function () {
    return Session.get(LOADING);
  }
});

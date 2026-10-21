import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import CSAFCreate from '/imports/lib/interactors/csaf/create';
import Notify from '/imports/api/notify';

const FORM = '#CSAFImportForm'
const MODAL = '#CSAFImportModal'
const LOADING = 'loadingInProgress'

// Shared by the two ways an import can fail after the document validated: a
// parse that throws here and now, and a create that rejects a tick later. Both
// have to stop the spinner, or the dialog is stuck whichever way it went.
function reportImportFailure(error) {
  Notify.danger('Error: ' + ((error && error.reason) || ' could not upload file'));
  Session.set(LOADING);
}

function validateAndImportCsaf(fileContent, fileName) {
  Meteor.callAsync('CSAF.Validate', {file: fileContent}).then(function() {
    let fileJson;
    try {
      fileJson = JSON.parse(fileContent)
    } catch (parseError) {
      console.log(parseError)
      reportImportFailure(parseError);
      return;
    }
    // CSAFCreate takes a SINGLE destructured argument and returns a promise - it
    // has never accepted a callback. Passing the success continuation as a second
    // argument dropped it silently, so a SUCCESSFUL import showed no toast, left
    // the dialog open and never cleared the loading flag; and because the
    // returned promise went unawaited, the try/catch around the call could not
    // see a rejection either (it is thrown on a later tick), making a failure an
    // unhandled rejection with the same stuck dialog.
    CSAFCreate({file: fileJson, name: fileName}).then(function () {
      Notify.success('File successfully uploaded.');
      $(MODAL).modal('hide');
      Session.set(LOADING);
    }).catch(reportImportFailure);
  }).catch(function(validateError) {
    Notify.danger(validateError.message);
    Session.set(LOADING);
  })
}

Template.CSAFImportModal.onCreated(function () {
  this.currentUpload = new ReactiveVar(false);
});

Template.CSAFImportModal.onRendered(function () {
  let modal = $(MODAL);

  modal.on('show.bs.modal', function () {
    $(FORM).validate().resetForm();
    modal.find('[name=filename]').val('');
    modal.find('[name=file]').val('').removeClass('error');
  });

  modal.find('input[name=file]').on('change', function () {
    modal.find('input[name=filename]').val(this.files[0] ? this.files[0].name : '');
  });

  $(FORM).validate({
    rules: {
      file: {
        required: true
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
      Session.set(LOADING, true)
      const file = $(form).find('[name=file]')[0].files[0];
      const validExtensions = ['.json'];
      const fileName = file.name;
      const fileExtension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!validExtensions.includes(fileExtension)) {
        Notify.danger('Invalid file type. Please upload a SARIF (.json) file.');
        Session.set(LOADING)
        return;
      }
       
      const reader = new FileReader();
      reader.onload = function(event) {
        validateAndImportCsaf(event.target.result, fileName);
      };
      reader.readAsText(file);
    }
  });
});

Template.CSAFImportModal.events({
  'submit #CSAFImportForm': function (event) {
    event.preventDefault();
  }
});

Template.CSAFImportModal.helpers({
  currentUpload() {
    return Template.instance().currentUpload.get();
  },
  loading: function () {
    return Session.get(LOADING);
  }
});

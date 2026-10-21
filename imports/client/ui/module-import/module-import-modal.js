import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import {ReactiveVar} from 'meteor/reactive-var'
import ModuleImportsCreate from '/imports/lib/interactors/moduleImports/create';
import {Session} from 'meteor/session';

function refreshModulesByProject() {
  Meteor.callAsync('modulesByProject', false, true).then(data => {
    Session.set('modulesByProject', data)
  })
}

Template.ModuleImportModal.onCreated(function () {
  this.currentUpload = new ReactiveVar(false);
  Session.set('moduleImportType', 'cyclonedx');
});

Template.ModuleImportModal.onRendered(function () {
  const modal = $('#ModuleImportModal');

  modal.find('#changeType').on('change', function () {
    Session.set('moduleImportType', this.checked ? 'cyclonedx' : 'spdx');
  });

  modal.find('input[name=file]').on('change', function () {
    const fileName = this.files[0] ? this.files[0].name : '';
    modal.find('input[name=filename]').val(fileName);
    // Prefill the module name from the file and leave it editable - the import names the
    // module by this field, so it can be pointed at the component's own name and match
    // what a scan or SARIF upload for that name resolves to.
    const moduleNameInput = modal.find('input[name=moduleName]');
    if (!moduleNameInput.data('touched')) {
      moduleNameInput.val(fileName);
    }
  });

  modal.find('input[name=moduleName]').on('input', function () {
    $(this).data('touched', true);
  });

  modal.on('show.bs.modal', function () {
    $('#SPDXImportForm').validate().resetForm();
    modal.find('[name=filename]').val('');
    modal.find('[name=file]').val('').removeClass('error');
    modal.find('[name=moduleName]').val('').removeData('touched');
  });

  $('#SPDXImportForm').validate({
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
      Session.set('loadingInProgress', true)
      const userId = Meteor.user()._id;
      const projectId = Router.current().params.projectId;
      const file = $(form).find('[name=file]')[0].files[0];
      const type = $(form).find('[name=changeType]')[0].checked ? 'cyclonedx' : 'spdx';
      const moduleName = ($(form).find('[name=moduleName]').val() || '').trim() || undefined;
      ModuleImportsCreate( {projectId, userId, file, type, moduleName}, function (error) {
        if (error) {
          const message = 'Error: ' + (error.reason || ' could not upload file');
          Notify.danger(message);
        } else {
          Notify.warn('You may check import status in Project settings - Imports');
          $('#ModuleImportModal').modal('hide');
          Meteor.setTimeout(refreshModulesByProject, 1000)
        }
        Session.set('loadingInProgress')
      });
    }
  });
});

Template.ModuleImportModal.events({
  'submit #SPDXImportForm': function (event) {
    event.preventDefault();
  }
});

Template.ModuleImportModal.helpers({
  currentUpload() {
    return Template.instance().currentUpload.get();
  },
  fileAccept: function () {
    // CycloneDX is imported as JSON only; SPDX as JSON or RDF/XML.
    return Session.get('moduleImportType') === 'cyclonedx' ? '.json' : '.json,.rdf,.xml';
  },
  isTypeCyclonedx: function () {
    return Session.get('moduleImportType') === 'cyclonedx';
  },
  loading: function () {
    return Session.get('loadingInProgress');
  }
});

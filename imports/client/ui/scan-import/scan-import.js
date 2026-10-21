import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Projects from '/imports/lib/collections/projects';
import ModuleImportsCreate from '/imports/lib/interactors/moduleImports/create';
import Notify from '/imports/api/notify';

const NEW_PROJECT_VALUE = '__NEW__';
const NEW_PROJECT_BASE_NAME = 'New project';

function refreshModulesByProject() {
  return Meteor.callAsync('modulesByProject', false, true).then(function (data) {
    Session.set('modulesByProject', data);
  });
}

function importScanFile({projectId, file, type, moduleName}) {
  const userId = Meteor.user()._id;
  ModuleImportsCreate({projectId, userId, file, type, moduleName}, function (error) {
    if (error) {
      Notify.danger('Error: ' + (error.reason || ' could not upload file'));
      Session.set('loadingInProgress');
      return;
    }
    Notify.warn('You may check import status in Project settings - Imports');
    refreshModulesByProject().finally(function () {
      Session.set('loadingInProgress');
      Router.go('projectModules', {projectId});
    });
  });
}

Template.scanImport.onCreated(function () {
  Session.set('moduleImportType', 'cyclonedx');
  Session.set('loadingInProgress');
});

Template.scanImport.onRendered(function () {
  document.body.classList.add('flex-fill-page');

  $('#currentProject').select2({width: '100%'});

  const form = $('#scanImportForm');

  form.on('change', '#changeType', function () {
    Session.set('moduleImportType', this.checked ? 'cyclonedx' : 'spdx');
  });

  form.on('change', 'input[name=file]', function () {
    const fileName = this.files[0] ? this.files[0].name : '';
    form.find('input[name=filename]').val(fileName);
    // Prefill the module name from the file, and leave it editable: the import names the
    // module by this field, so the user can point it at the component's real name and have
    // a later scan or SARIF upload for that name land on the same module.
    const moduleNameInput = form.find('input[name=moduleName]');
    if (!moduleNameInput.data('touched')) {
      moduleNameInput.val(fileName);
    }
  });

  form.on('input', 'input[name=moduleName]', function () {
    $(this).data('touched', true);
  });

  form.validate({
    rules: {
      file: {required: true},
      currentProject: {required: true}
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (formEl) {
      Session.set('loadingInProgress', true);
      const $form = $(formEl);
      const file = $form.find('[name=file]')[0].files[0];
      const type = $form.find('[name=changeType]')[0].checked ? 'cyclonedx' : 'spdx';
      const moduleName = ($form.find('[name=moduleName]').val() || '').trim() || undefined;
      const selectedValue = $form.find('[name=currentProject]').val();

      if (selectedValue === NEW_PROJECT_VALUE) {
        // uniqueSuffix leaves it to the server to settle on a free name. Only the server
        // sees every name in the company: Minimongo here is filtered by relatedUsers, so
        // picking the name on the client would happily choose one that a project the user
        // cannot see already holds. The import uses the id the server actually created.
        Meteor.callAsync('Projects.Create', {
          name: NEW_PROJECT_BASE_NAME,
          uniqueSuffix: true
        }).then(function (project) {
          importScanFile({projectId: project.projectId, file, type, moduleName});
        }).catch(function (error) {
          Notify.danger('Error: ' + (error.reason || ' could not create project'));
          Session.set('loadingInProgress');
        });
      } else {
        importScanFile({projectId: selectedValue, file, type, moduleName});
      }
    }
  });
});

Template.scanImport.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.scanImport.events({
  'submit #scanImportForm': function (event) {
    event.preventDefault();
  }
});

Template.scanImport.helpers({
  projects: function () {
    return Projects.find({}, {sort: {name: 1}}).fetch();
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

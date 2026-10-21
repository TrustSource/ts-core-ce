import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

// The modal lives inside `{{#if isInRole ...}}`, which resolves asynchronously in
// Meteor 3, and the global show.bs.modal handler moves modals to <body>. So nothing
// here binds to the form at render time: document-delegated modal events bind the
// validator when the modal is shown (same pattern as license-create.js).
function createInfrastructureComponentSubmitHandler(form) {
  const $form = $(form);
  const $submit = $form.find('[type=submit]');
  const input = {
    name: $form.find('[name=componentName]').val() || '',
    key: $form.find('[name=componentKey]').val() || '',
    versions: $form.find('[name=componentVersions]').val() || '',
    homepage: $form.find('[name=componentHomepage]').val() || '',
    repository: $form.find('[name=componentRepository]').val() || ''
  };
  // A second click while the first create is still on its way would only come back
  // as "already exists".
  $submit.prop('disabled', true);
  Meteor.callAsync('InfrastructureComponents.Create', input).then(function () {
    Notify.success('Component successfully created!');
    // The list and its count are one-off method results; bump the revision the list
    // folds into its call so both are fetched again.
    Session.set('infrastructureComponentsRevision', (Session.get('infrastructureComponentsRevision') || 0) + 1);
    Meteor.callAsync('countInfrastructureComponents').then(function (count) {
      Session.set('infrastructureComponentCount', count);
    });
    $('#createInfrastructureModule').modal('hide');
  }).catch(function (error) {
    Notify.danger('Error: ' + (error.reason || 'could not create component'));
  }).finally(function () {
    $submit.prop('disabled', false);
  });
}

function bindCreateInfrastructureComponentValidation() {
  const form = $('#createInfrastructureModuleForm');
  if (!form.length) return;
  // destroy(), not removeData('validator'): dropping only the data leaves the old
  // submit handler bound, and every reopen would add one more create per click.
  const existing = form.data('validator');
  if (existing) existing.destroy();
  form.validate({
    rules: {
      componentName: {required: true, maxlength: 200},
      componentKey: {maxlength: 200},
      componentHomepage: {url: true, maxlength: 2000},
      componentRepository: {url: true, maxlength: 2000}
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: createInfrastructureComponentSubmitHandler
  });
}

Template.infrastructureManagementComponentCreate.onRendered(function () {
  $(document).off('.infrastructureManagementComponentCreate')
    .on('show.bs.modal.infrastructureManagementComponentCreate', '#createInfrastructureModule', function (e) {
      const validator = $('#createInfrastructureModuleForm').data('validator');
      if (validator) validator.resetForm();
      $(e.currentTarget).find('input').val('').removeClass('error');
    })
    .on('shown.bs.modal.infrastructureManagementComponentCreate', '#createInfrastructureModule',
      bindCreateInfrastructureComponentValidation);
});

Template.infrastructureManagementComponentCreate.onDestroyed(function () {
  $(document).off('.infrastructureManagementComponentCreate');
});

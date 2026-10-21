import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

// The modal lives inside `{{#if isInRole ...}}`, which resolves asynchronously in
// Meteor 3, and the global show.bs.modal handler moves modals to <body>. So nothing
// here binds to the form at render time: document-delegated modal events bind the
// validator when the modal is shown (same pattern as project-list.js).
function createLicenseSubmitHandler(form) {
  const $form = $(form);
  const input = {
    key: ($form.find('[name=licenseKey]').val() || '').trim(),
    name: ($form.find('[name=licenseName]').val() || '').trim(),
    url: ($form.find('[name=licenseUrl]').val() || '').trim(),
    text: $form.find('[name=licenseText]').val() || ''
  };
  Meteor.callAsync('Licenses.Create', input).then(function (key) {
    Notify.success('License successfully created!');
    $('#createLicense')
      .one('hidden.bs.modal', function () {
        Router.go('licenseDetail', {key: key});
      })
      .modal('hide');
  }).catch(function (error) {
    Notify.danger('Error: ' + (error.reason || 'could not create license'));
  });
}

function bindCreateLicenseValidation() {
  const form = $('#createLicenseForm');
  if (!form.length) return;
  // destroy(), not removeData('validator'): dropping only the data leaves the old
  // submit handler bound, and every reopen would add one more create per click.
  const existing = form.data('validator');
  if (existing) existing.destroy();
  form.validate({
    rules: {
      licenseKey: {required: true, maxlength: 100},
      licenseName: {required: true, maxlength: 200},
      licenseUrl: {url: true, maxlength: 2000}
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: createLicenseSubmitHandler
  });
}

Template.licenseCreate.onRendered(function () {
  $(document).off('.licenseCreate')
    .on('show.bs.modal.licenseCreate', '#createLicense', function (e) {
      const validator = $('#createLicenseForm').data('validator');
      if (validator) validator.resetForm();
      $(e.currentTarget).find('input, textarea').val('').removeClass('error');
    })
    .on('shown.bs.modal.licenseCreate', '#createLicense', bindCreateLicenseValidation);
});

Template.licenseCreate.onDestroyed(function () {
  $(document).off('.licenseCreate');
});

Template.licenseCreate.helpers({
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId;
  }
});

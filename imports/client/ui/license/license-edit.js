import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

function aliasesFromLines(value) {
  return (value || '').split('\n')
    .map(function (line) { return line.trim(); })
    .filter(Boolean);
}

// The route renders this template only once the license is loaded (waitOn), and
// renders the licenseEditNotFound template instead when the key does not exist
// (the dataNotFound plugin, imports/lib/router.js), so the form exists at onRendered.
Template.licenseEdit.onRendered(function () {
  const template = this;
  template.$('#licenseEditForm').validate({
    rules: {
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
    submitHandler: function (form) {
      const $form = $(form);
      const key = template.data && template.data.key;
      const input = {
        name: ($form.find('[name=licenseName]').val() || '').trim(),
        url: ($form.find('[name=licenseUrl]').val() || '').trim(),
        aliases: aliasesFromLines($form.find('[name=licenseAliases]').val()),
        copyright: $form.find('[name=licenseCopyright]').val() || '',
        text: $form.find('[name=licenseText]').val() || ''
      };
      Meteor.callAsync('Licenses.Update', key, input).then(function () {
        Notify.success('License updated!');
        Router.go('licenseDetail', {key: key});
      }).catch(function (error) {
        Notify.danger('Error: ' + (error.reason || 'could not update license'));
      });
    }
  });
});

Template.licenseEdit.helpers({
  getName: function () {
    return this && this.name || '';
  },
  getKey: function () {
    return this && this.key || '';
  },
  getUrl: function () {
    return this && this.url || '';
  },
  getAliases: function () {
    return this && Array.isArray(this.aliases) ? this.aliases.join('\n') : '';
  },
  getCopyright: function () {
    return this && this.copyright || '';
  },
  getText: function () {
    return this && this.text || '';
  },
  hasCreatedOrUpdate: function () {
    return this.created || this.updated;
  },
  getCreated: function () {
    return this.created;
  }
});

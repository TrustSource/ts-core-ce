import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import COTSComponents from '/imports/lib/collections/cotsComponents';
import Utils from '/imports/lib/utils';


Template.cotsManagementComponentCreate.onRendered(function () {
  $('#createCOTSModuleForm').validate({
    rules: {
      componentName: {
        required: true,
        minlength: 1
      },
      componentKey: {
        required: false
      },
      componentVersions: {
        required: false
      },
      componentHomepage: {
        required: false
      },
      componentRepository: {
        required: false
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
      const now = new Date();
      const name = $(form).find('[name=componentName]').val();
      const generatedKey = 'im:'+Utils.generateModuleIdentifier(name);
      let key = $(form).find('[name=componentKey]').val() || generatedKey;
      let versions = $(form).find('[name=componentVersions]').val();
      versions = _.map(versions.split(','),function (version) {
        return {version}
      });
      const homepage = $(form).find('[name=componentHomepage]').val();
      const repository = $(form).find('[name=componentRepository]').val();
      const urls = {homepage, repository};
      const created = now;
      const createdBy = Utils.username();
      let component = {name, key: key.toLowerCase(), versions, created, createdBy, urls};
      if (COTSComponents.findOne({name})) {
        Session.set('createCOTSModuleMsg', 'Error: ' + ' Component with same name already exists');
      } else {
        const user = Meteor.user();
        COTSComponents.insertAsync(component).then(function () {
          Meteor.callAsync('logEvent', user, 'COTS component '+component.name+' created', 'cotsComponentCreated');
          Session.set('createCOTSModuleMsg', 'Component successfully created!');
          Meteor.setTimeout(function () {
            $('#createCOTSModule').modal('hide');
          }, 300);
        }).catch(function (error) {
          const message = 'Error: ' + (error.reason || ' could not create component');
          Meteor.callAsync('logEvent', user, message, 'cotsComponentCreated');
          Session.set('createCOTSModuleMsg', message);
        });
      }
    }
  });

  $('#createCOTSModule').off('.cotsManagementComponentCreate')
    .on('show.bs.modal.cotsManagementComponentCreate', function (event) {
      $('#createCOTSModuleForm').validate().resetForm();
      $(event.target).find('[name=moduleName]').val('').removeClass('error');
      Session.set('createCOTSModuleMsg');
    })
    .on('hidden.bs.modal.cotsManagementComponentCreate', function () {
      Session.set('createCOTSModuleMsg');
    });
});

Template.cotsManagementComponentCreate.onDestroyed(function () {
  $('#createCOTSModule').off('.cotsManagementComponentCreate');
});

Template.cotsManagementComponentCreate.events({
  'submit #createCOTSModuleForm': function (event) {
    event.preventDefault();
  }
});

Template.cotsManagementComponentCreate.helpers({
  createCOTSModuleMsgType: function () {
    const msg = Session.get('createCOTSModuleMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createCOTSModuleMsg: function () {
    return Session.get('createCOTSModuleMsg');
  }
});

/* global swal:false */

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {AutoForm} from 'meteor/aldeed:autoform';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {ModuleVersioningConfigSchema} from '/imports/lib/schemas/moduleSchema';

function validateForm() {
  Meteor.setTimeout(() => {
    if ($('#updateModuleFormVersioningConfig').length) {
      AutoForm.validateForm('updateModuleFormVersioningConfig');
    }
  }, 300);
}

Template.moduleSettingsVersioning.onRendered(function () {
  Session.set('importFilter');
  validateForm();
});

Template.moduleSettingsVersioning.events({
  'click .copy-versioning-settings': function (event) {
    event.preventDefault();
    const module = Template.currentData();
    const srcModule = Modules.findOne({_id: event.target.id}, {fields: {name: 1, versioningConfig: 1}});
    if (srcModule) {
      Meteor.callAsync('Modules.UpdateVersioningConfig', module._id, srcModule.versioningConfig).then(function () {
        Notify.success('Versioning settings copied from module: ' + (srcModule.name));
      }).catch(function (error) {
        console.log('Error updating Module:', error);
      });
    }
  },
  'click input[name="versioningConfigEnabled"]': function (event) {
    event.preventDefault();
    swal({
      title: 'Are you sure you want to update Versioning analysis settings?',
      text: 'This will re-process module to update status and statistics!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#2a94a2',
      confirmButtonText: 'Yes, update settings!'
    }, function () {
      const user = Meteor.user();
      const module = Modules.findOne({_id: Router.current().params.moduleId}, {
        fields: {
          name: true,
          versioningConfig: true,
          infrastructureComponent: true,
          cotsComponent: true
        }
      });
      let versioningConfig = module.versioningConfig || {};
      versioningConfig.enabled = !(module && module.versioningConfig && module.versioningConfig.enabled);
      Meteor.callAsync('Modules.UpdateVersioningConfig', module._id, versioningConfig).then(function () {
        Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' versioning settings changed', 'moduleVersioningSettingsUpdated');
        Notify.success('Modules versioning settings successfully changed');
        if((module.infrastructureComponent && module.infrastructureComponent.key) ||
            (module.cotsComponent && module.cotsComponent.key)){
          Meteor.callAsync('Modules.AnalyzeWithoutScan', module._id).then(function(data) {
            if (!data) {
              Notify.danger('Internal Error! The check service is not available.');
            }
          })
        }else{
          Meteor.callAsync('analyzeModule', module._id).then(function(data) {
            if (!data) {
              Notify.danger('Internal Error! The check service is not available.');
            }
          });
        }
      }).catch(function (err) {
        Notify.danger(err.message);
      });
    });
  },
  'input .import_filter': function (event) {
    Session.set('importFilter', $(event.target).val())
  }
});

Template.moduleSettingsVersioning.helpers({

  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  getVersioningSettingsModules: function () {
    const moduleArray = Modules.find(
      {_id: {$ne: this._id}, versioningConfig: {$exists: true}, name: {$exists: true}}).fetch();
    return _.filter(moduleArray, m => m.versioningSettingsValid());
  },

  getVersioningConfig: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    let module = moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
    return module && module.versioningConfig || {};
  },

  getModules() {
    return Modules;
  },

  getModuleVersioningConfigSchema() {
    return ModuleVersioningConfigSchema;
  },

  filterList: function (list, filter) {
    return _.filter(list, m => {
      return m.getName().toLowerCase().indexOf(filter.toLowerCase()) > -1
    }).slice(0, 9);
  },

  getImportFilter: function () {
    return Session.get('importFilter') || '';
  }

});

AutoForm.hooks({
  updateModuleFormVersioningConfig: {
    onSubmit: function (insertDoc) {
      let self = this;
      try {
        const formContext = Template.currentData();
        insertDoc.enabled = true;
        const module = Modules.findOne(Router.current().params.moduleId, {fields: {name: true}});
        Meteor.callAsync('Modules.UpdateVersioningConfig', formContext.docId, insertDoc).then(function () {
          const user = Meteor.user();
          Notify.success('Versioning settings changed!');
          Meteor.callAsync('logEvent', user, 'Module ' + module.name + ' Versioning settings changed', 'moduleVersioningSettingsUpdated');
          self.done();
        }).catch(function (error) {
          const user = Meteor.user();
          Notify.danger('Internal Error! Versioning settings not changed: ' + error.message);
          Meteor.callAsync('logEvent', user, error.message, 'moduleVersioningSettingsUpdated');
          self.done(new Error('Submission failed'));
        });
      } catch (error) {   // catch errors and prevent default submit handling by returning false in every case
        console.log('Error in onSubmit()', error);
        self.done(new Error('Submission failed'));
      }
      return false;
    },
    onError: function () {
      console.log('updateModuleFormVersioningConfig-onError: ', arguments);
    }
  }
});

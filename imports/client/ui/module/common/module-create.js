import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Tracker} from 'meteor/tracker';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Module from '/imports/lib/project/Module';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';

const VERSION_CLASS = '[name=moduleVersion]';

function refreshSelect2() {
  Tracker.afterFlush(function () {
    $('#createModule .select2').each(function () {
      const $el = $(this);
      if ($el.data('select2')) $el.select2('destroy');
      $el.select2({width: '100%'});
    });
  });
}

function refreshModulesByProject() {
  Meteor.callAsync('modulesByProject', false, true).then(function (data) {
    Session.set('modulesByProject', data)
  })
}

function moduleCreateCallback(error) {
  const user = Meteor.user();
  Session.set('createLoading')
  if (error) {
    const message = 'Error: ' + (error.reason || ' could not create module');
    Meteor.callAsync('logEvent', user, message, 'moduleCreated');
    Session.set('createModuleMsg', message);
  } else {
    Session.set('createModuleMsg', 'Module successfully created!');
    Meteor.setTimeout(function () {
      $('#createModule').modal('hide');
      Meteor.setTimeout(function () {
        Session.set('modalVisible',false);
      }, 200);
    }, 300);
  }
}

function initCreateModuleForm() {
  const form = $('#createModuleForm');
  if (!form.length) return;
  form.validate({
    submitHandler: function (form) {
      const user = Meteor.user();
      const router = Router.current();
      let moduleName, moduleVersion, moduleOpenSource, moduleListType, approveName,
        approveModules, projectId, approveId, moduleUrls;
      let type = Session.get('createCustomModule');
      Session.set('createLoading', true)
      if (type === 'custom'){
        moduleName = $(form).find('[name=moduleCustomName]').val();
      }else if (type === 'external'){
        if (Session.get('isCustomModule')) {
          moduleName = $(form).find('[name=moduleName]').val();
          moduleVersion = $(form).find(VERSION_CLASS).val().trim();
        } else {
          const extComponent = Session.get('componentTypeaheadComponent');
          const extVersion = Session.get('versionTypeaheadVersion');
          moduleName = extComponent.name;
          moduleUrls = extComponent.urls;
          moduleVersion = extVersion.version;
          if(!moduleVersion){
            moduleVersion = $(form).find('[name=searchVersions]').val().trim();
          }
          moduleListType = extComponent.listType;
        }
        moduleOpenSource = $(form).find('[name=moduleOpenSource]:checked').val();
      }else if (type === 'link'){
        const parts = $(form).find('[name=moduleTemplate]').val().split('++');
        projectId = parts[0];
        approveId = parts[1];
        moduleListType = parts[2];
        let template = _.find(Session.get('approvedProjects'),function (item) {
          return item._id === projectId
        });
        let version = _.find(template.versions, function (item) {
          return item._id === approveId
        });
        moduleName = template.name;
        moduleVersion = version.version;
        approveName = version.name;
        approveModules = version.modules;
      }
      if(!moduleName){
        const message = 'Error: Component is not found in Component lake. ' +
          'Pick one that exist or click link below Name to specify own component';
        Notify.warn(message);
        return false
      }
      let module = new Module(user.profile.companyId, moduleName, Utils.generateModuleIdentifier(moduleName));
      if (type === 'external'){
        module.version = moduleVersion;
        module.properties = {};
        module.properties.architectureType = $(form).find('[name=moduleArchitectureType]').val();
        if (moduleOpenSource) {
          module.properties.privacy = moduleOpenSource;
        } else {
          module.properties.privacy = 'private';
        }
        module.properties.architecture = moduleListType ? moduleListType : 'infrastructureModule';
        const extComponent = Session.get('componentTypeaheadComponent');
        if(extComponent){
          const parts = extComponent.key.split('im:');
          module.moduleIdentifier = parts[1] ? parts[1] : parts[0];
          module.commercialTerms = extComponent.commercialTerms || null
        }
        if(moduleListType === 'cotsModule'){
          module.cotsComponent = {
            key: extComponent? extComponent.key : module.moduleIdentifier,
            version:moduleVersion,
            public:!!moduleOpenSource
          };
        }else{
          module.infrastructureComponent = {
            key: extComponent? extComponent.key : module.moduleIdentifier,
            version:moduleVersion,
            public:!!moduleOpenSource
          };
        }
      }else if (type === 'link'){
        module.version = moduleVersion;
        module.properties = {};
        module.properties.privacy = 'private';
        module.properties.architecture = 'linkedProject';
        module.linkedProject = {
          projectId,
          projectName: moduleName,
          approveId,
          approveName: approveName,
          approveVersion: moduleVersion,
          approveModules: approveModules
        };
      }
      if(router.params.projectId !== Projects.UNASSIGNED){
        module.projectId = router.params.projectId;
      }
      if(moduleUrls){
        module.urls = moduleUrls
      }
      module.moduleIdentifier = module.moduleIdentifier.split(' ').join('');
      Meteor.callAsync('setModuleRelatedUsers', Meteor.user()._id, module).then(function(result) {
        module = result;
        const createMethod = type === 'link' ? 'createLinkedModule' : 'Modules.Create';
        Meteor.callAsync(createMethod, module).then(function () {
          moduleCreateCallback();
          refreshModulesByProject();
        }).catch(function(error) {
          moduleCreateCallback(error);
        });
      }).catch(function(error) {
        Session.set('createLoading')
        const message = 'Internal Error: ' + (error.reason || 'Module: ' + module.name + ' not created');
        Notify.danger(message);
        Meteor.callAsync('logEvent', user, message, 'moduleCreated');
      });
    }
  });
}

Template.moduleCreate.onRendered(function () {
  Session.set('approvedProjects');
  initCreateModuleForm();

  Meteor.callAsync(
    'getApprovedProjects',
    {projectId:{$ne: Router.current().params.projectId}}
  ).then(function(result) {
    if (result) {
      let newPart = _.filter(_.map(result, function (item) {
        if(item){
          item.listType = 'approvedProject';
        }
        return item
      }), function (item) {
        return !!item
      });
      Session.set('approvedProjects', newPart);
      refreshSelect2();
    }
  }).catch(function(error) {
    console.log(error);
  });
});

$(document).on('shown.bs.modal', '#createModule', function () {
  initCreateModuleForm();
  const $modal = $('#createModule');
  $modal
    .off('click.toggleCustomFields')
    .on('click.toggleCustomFields', '.toggle-custom-fields', function (event) {
      event.preventDefault();
      Session.set('isCustomModule', !Session.get('isCustomModule'));
    })
    .off('change.moduleType')
    .on('change.moduleType', '#moduleType', function (event) {
      Session.set('createCustomModule', $(event.target).val());
      refreshSelect2();
    });
  refreshSelect2();
});

Template.moduleCreate.events({
  'click .showNextModal': function (event) {
    event.preventDefault();
    Session.set('modalVisible',true);
    Meteor.setTimeout(function () {
      $('#createModule').modal('show');
    },1)
  }
});

$(document).on('show.bs.modal', '#createModule', function () {
  Session.set('isCustomModule', false);
  Session.set('createCustomModule', 'external');
  Session.set('componentTypeaheadComponent', false);
  Session.set('versionTypeaheadVersion', false);
  const form = $('#createModuleForm');
  if (form.data('validator')) form.validate().resetForm();
  $(this).find('[name=moduleCustomName]').val('').removeClass('error');
  $(this).find('[name=moduleName]').val('').removeClass('error');
  $(this).find('[name=moduleArchitectureType]').val('').removeClass('error');
  $(this).find(VERSION_CLASS).val('').removeClass('error');
  Session.set('createModuleMsg');
  refreshSelect2();
});

$(document).on('hidden.bs.modal', '#createModule', function () {
  Session.set('createModuleMsg');
  Session.set('modalVisible');
});

Template.moduleCreate.helpers({
  modalVisible: function () {
    return Session.get('modalVisible') || false
  },

  createModuleMsgType: function () {
    const msg = Session.get('createModuleMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createModuleMsg: function () {
    return Session.get('createModuleMsg');
  },

  isCustomModule: function () {
    return Session.get('isCustomModule');
  },

  approvedProjects: function () {
    const templates = Session.get('approvedProjects');
    let model = [];
    _.each(templates, function (item) {
      let versions = [];
      let versionList = item.versions;
      _.each(versionList, function (elem) {
        versions.push({
          label: item.name + (elem.version ? (' - ' + elem.version) : '') + ' - ' + elem.name,
          value: item._id + '++' + elem._id+ '++'+ item.listType
        });
      });
      model.push({
        optgroup: item.name,
        options: versions
      });
    });
    return model;
  },

  createCustomModule: function () {
    return Session.get('createCustomModule') === 'custom';
  },

  createInfrastructureComponent: function () {
    return Session.get('createCustomModule') === 'external';
  },

  createLinkedModule: function () {
    return Session.get('createCustomModule') === 'link';
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  loading: function () {
    return Session.get('createLoading')
  }
});

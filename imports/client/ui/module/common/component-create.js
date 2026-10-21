import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';


function initCreateComponentForm() {
  const form = $('#createComponentForm');
  if (!form.length) return;
  form.validate({
    rules: {
      registeredComponent: {
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
      const user = Meteor.user();
      let element = Session.get('customComponent');
      const currentModule = Modules.findOne(Router.current().params.moduleId);
      if (element){
        saveComponent(currentModule, user, element)
      }else{
        const selectComponent = Session.get('selectComponent');
        const pkgType = $(form).find('[name=pkgType]').val();
        const pkgName = $(form).find('[name=pkgName]').val();
        const pkgVersion = $(form).find('[name=pkgVersion]').val();
        const pkgRepo = $(form).find('[name=pkgRepo]').val();
        if(selectComponent && pkgVersion){
          const component = Session.get('selectComponent')
          Meteor.callAsync('Components.PublicCreateVersion', {component, pkgVersion}).then(data => {
            let version = data
            component.versions = [version.version]
            component.licenses = version.licenses
            element = component;
            saveComponent(currentModule, user, element)
          }).catch(error => {
            Notify.warn('Error: '+ error.reason);
          })
        }else if(pkgType && pkgName && pkgVersion){
          Meteor.callAsync('Components.PublicCreate', {pkgType, pkgName, pkgVersion, pkgRepo}).then(data => {
            let component = data
            let version = component.versions && component.versions[0] || {}
            element = {
              'name' : component.name,
              'key' : component.key,
              'description' : component.description,
              'licenses' : version.licenses || [],
              'homepageUrl' : component.urls && component.urls.homepage,
              'repoUrl' : component.urls && component.urls.repository,
              'dependencies' : [],
              'versions' : version && version.version ? [version.version] : []
            }
            saveComponent(currentModule, user, element)
          }).catch(error => {
            Notify.warn('Error: '+ error.reason);
          })
        }else{
          Notify.warn('Error: component and version are not selected');
        }
      }
    }
  });
}

Template.componentCreate.onRendered(function () {
  Session.set('selectComponent')
  Session.set('customComponent')
  initCreateComponentForm();
});

$(document).on('shown.bs.modal', '#createComponent', function () {
  initCreateComponentForm();
});

function saveComponent(currentModule, user, element){
  if (_.any(currentModule.customComponents,function (component) {
    return component.key === element.key && component.versions[0] === element.versions[0]
  })) {
    Notify.danger('Error: component with same version already exists in module');
  } else {
    Meteor.callAsync('Modules.UpdateCustomComponents', currentModule._id, {$push: {'customComponents': element}, $set: {analysisRequired: true}}).then(() => {
      Meteor.callAsync('logEvent', user, 'Component '+element.key+' has been added manually to module '+ currentModule.name,
        'customComponent');
      Notify.successHtml('Component successfully added! <br>' +
        'NOTE: Components added manually will not appear in the component or legal views until you have executed ' +
        'a new analysis run!  The views actually are representations of an analysis result.');
      Meteor.setTimeout(function () {
        $('#createComponent').modal('hide');
      }, 300);
    }).catch((error) => {
      let textError = 'Error: ' + (error.reason || ' could not add component');
      Meteor.callAsync('logEvent', user, textError, 'customComponent');
      Notify.danger(textError);
    })
  }
}

Template.componentCreate.events({});

$(document).on('show.bs.modal', '#createComponent', function () {
  const form = $('#createComponentForm');
  if (form.data('validator')) form.validate().resetForm();
  $(this).find('input').val('').removeClass('error');
  Session.set('createComponentMsg');
  Session.set('selectComponent');
  Session.set('customComponent');
  Session.set('filterSettingscomponents');
  Session.set('filterSettingsversions');
});

$(document).on('hidden.bs.modal', '#createComponent', function () {
  Session.set('createComponentMsg');
  Session.set('selectComponent');
  Session.set('customComponent');
  Session.set('filterSettingscomponents');
  Session.set('filterSettingsversions');
  $(this).find('input').val('').removeClass('error');
});

Template.componentCreate.helpers({
  createComponentMsgType: function () {
    let msg = Session.get('createComponentMsg');
    return msg && msg.indexOf('Error') === 0 ? 'text-danger' : 'text-normal';
  },

  createComponentMsg: function () {
    return Session.get('createComponentMsg');
  },

  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  customComponent: function () {
    return Session.get('customComponent')
  }
});

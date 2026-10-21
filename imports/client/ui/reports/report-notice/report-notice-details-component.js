import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';

Template.noticeFileDetailsComponent.onRendered(function () {
  const templateData = Template.currentData();
  Session.set('showDetails'+templateData.uuid);
});

function getOptimizedLicenseKey(key) {
  return key && key.split(/[.#:@/() ]/).join('') || 'unknown'
}

Template.noticeFileDetailsComponent.events({

  'click .toggle_view': function (event) {
    event.preventDefault();
    const templateData = Template.currentData();
    Session.set('showDetails'+templateData.uuid, !Session.get('showDetails'+templateData.uuid));
  },

   
  'click .save_component': function (event) {
    event.preventDefault();
    const templateData = Template.currentData();
    event.preventDefault();
    let form = $(event.target).closest('.edit_component');
    const noticeFile = templateData.noticeFile;
    let licenseObject;
    const copyrightInput = form.find('[name=copyright]');
    const changedInput = form.find('[name=unchanged]');
    const changesUrlInput = form.find('[name=changesUrl]');
    const changedSourcesUrlInput = form.find('[name=changedSourcesUrl]');
    const changesTextInput = form.find('[name=changesText]');
    const sourcesUrlInput = form.find('[name=sourcesUrl]');
    const license = $(event.target).closest('.panel_with_license').attr('data-license-key');
    const componentKey = $(event.target).closest('.panel_with_component').attr('data-component-key');
    licenseObject = _.find(noticeFile.licenses, function (licenseItem) {
      return getOptimizedLicenseKey(licenseItem.key) === license
    });
    let componentObject = _.find(licenseObject.components, function (componentItem) {
      return getOptimizedLicenseKey(componentItem.key) === componentKey
    });
    const componentUpdates = {
      component: _.clone(componentObject),
      updates: {
        copyright: copyrightInput && copyrightInput.val(),
        unchanged: changedInput && changedInput.prop('checked'),
        changesUrl: changesUrlInput && changesUrlInput.val(),
        changedSourcesUrl: changedSourcesUrlInput && changedSourcesUrlInput.val(),
        changesText: changesTextInput && changesTextInput.val(),
        sourcesUrl: sourcesUrlInput && sourcesUrlInput.val()
      },
      moduleId: noticeFile.moduleId,
      projectId: noticeFile.projectId
    };
    if(copyrightInput){
      let value = copyrightInput.val();
      componentObject.copyright = value;
      let componentActionsRequired = _.find(componentObject.actionsRequired, function (componentObjectItem) {
        return componentObjectItem.key === 'Copyright'
      });
      if(componentActionsRequired){
        if(value) {
          componentActionsRequired.completed = true;
        }else{
          componentActionsRequired.completed = false;
        }
      }
    }
    if(changedInput){
      componentObject.unchanged = changedInput.prop('checked')
    }
    if(changesUrlInput){
      let value = changesUrlInput.val();
      componentObject.changesUrl = value;
      let componentActionsRequired = _.find(componentObject.actionsRequired, function (componentObjectItem) {
        return componentObjectItem.key === 'Modifications'
      });
      if(componentActionsRequired){
        if(value) {
          componentActionsRequired.completed = true;
        }else{
          componentActionsRequired.completed = false;
        }
      }
    }
    if(changedSourcesUrlInput){
      let value = changedSourcesUrlInput.val();
      componentObject.changedSourcesUrl = value;
      let componentActionsRequired = _.find(componentObject.actionsRequired, function (componentObjectItem) {
        return componentObjectItem.key === 'ModifiedSources'
      });
      if(componentActionsRequired){
        if(value) {
          componentActionsRequired.completed = true;
        }else{
          componentActionsRequired.completed = false;
        }
      }
    }
    if(changesTextInput){
      let value = changesTextInput.val();
      componentObject.changesText = value;
      let componentActionsRequired = _.find(componentObject.actionsRequired, function (componentObjectItem) {
        return componentObjectItem.key === 'ModificationsText'
      });
      if(componentActionsRequired){
        if(value) {
          componentActionsRequired.completed = true;
        }else{
          componentActionsRequired.completed = false;
        }
      }
    }
    if(sourcesUrlInput){
      let value = sourcesUrlInput.val();
      componentObject.sourcesUrl = value;
      let componentActionsRequired = _.find(componentObject.actionsRequired, function (componentObjectItem) {
        return componentObjectItem.key === 'Sources'
      });
      if(componentActionsRequired){
        if(value) {
          componentActionsRequired.completed = true;
        }else{
          componentActionsRequired.completed = false;
        }
      }
    }
    if(_.all(componentObject.actionsRequired,function (action) {
      return action.completed
    })){
      componentObject.completed = true
    }
    templateData.updateFunction({
      '$set':{
        'licenses.$': licenseObject
      }
    },noticeFile, {_id: noticeFile._id, licenses: {
      $elemMatch:{
        key: licenseObject && licenseObject.key
      }}
    }, componentUpdates);
  }

});

Template.noticeFileDetailsComponent.helpers({
  showDetails: function () {
    const templateData = Template.currentData();
    return Session.get('showDetails'+templateData.uuid)
  },

  isModified: function () {
    const templateData = Template.currentData();
    return templateData.component.unchanged ? ' not' :  ''
  },

  isUnchanged: function () {
    const templateData = Template.currentData();
    return templateData.component.unchanged ? 'checked' : null
  },

  reportDisabled: function () {
    const templateData = Template.currentData();
    return templateData.reportDisabled
  },

  hasAction: function (key) {
    const templateData = Template.currentData();
    if(templateData && templateData.component && templateData.component.actionsRequired){
      if(key.indexOf(',') > -1){
        return _.some(templateData.component.actionsRequired, function (action) {
          return key.split(',').indexOf(action.key) > -1
        })
      }else {
        return _.some(templateData.component.actionsRequired, function (action) {
          return action.key === key
        })
      }
    }
  },

  isFrozen: function () {
    let templateData = Template.currentData();
    return templateData.noticeFile.disabled
  },

  isManullyChanged: function () {
    let templateData = Template.currentData();
    return templateData.component.unchanged !== templateData.component.unchangedInitValue && templateData.component.unchanged
  }
});

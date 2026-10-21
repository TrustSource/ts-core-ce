import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import Modules from '/imports/lib/collections/modules';


Template.moduleSettingsCustomComponents.events({
  'click .delete_custom': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const currentModule = Modules.findOne(Router.current().params.moduleId);
    const element = this;
    Meteor.callAsync('Modules.UpdateCustomComponents', currentModule._id, {$pull: {'customComponents': element}}).then(() => {
      Meteor.callAsync('logEvent', user, 'Manually added component '+element.key+' has been removed from module'+ currentModule.name,
        'customComponent');
      Notify.success('Component '+element.name+' successfully removed!');
      Meteor.setTimeout(function () {
        $('#createComponent').modal('hide');
      }, 300);
    }).catch((error) => {
      let textError = 'Error: ' + (error.reason || ' could not remove component');
      Meteor.callAsync('logEvent', user, textError, 'customComponent');
      Notify.danger(textError);
    })
  }
});

Template.moduleSettingsCustomComponents.helpers({
  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  getLicense: function () {
    return this.licenses[0] && this.licenses[0].name || 'unknown';
  }
});

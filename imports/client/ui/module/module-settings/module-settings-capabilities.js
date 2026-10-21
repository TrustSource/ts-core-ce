import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import _ from 'underscore';


Template.moduleSettingsCapabilities.onRendered(function () {
  this.autorun(function () {
    const moduleId = Router.current().params.moduleId
    Meteor.callAsync('Capabilities.Find', {moduleId}).then(function(results) {
      Session.set('getCapabilitiesList', _.sortBy((results ? results : []), 'created').reverse());
    });
  });
});

Template.moduleSettingsCapabilities.helpers({

  getCapabilitiesList: function () {
    return Session.get('getCapabilitiesList')
  },

  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  }

});

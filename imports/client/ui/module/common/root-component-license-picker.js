import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import _ from 'underscore';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';

function getCurrentLicense(moduleId, rootKey) {
  if (!moduleId || !rootKey) return '';
  const module = Modules.findOne(moduleId, {fields: {componentConfig: 1}});
  const list = (module && module.componentConfig && module.componentConfig.licensesSelected) || [];
  const entry = _.find(list, function (e) { return e && e.key === rootKey && e.license; });
  return entry ? entry.license : '';
}

Template.rootComponentLicensePicker.onCreated(function () {
  this.subscribe('licenses', true);
});

Template.rootComponentLicensePicker.helpers({
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId;
  },

  shouldRender: function () {
    return !!(this && this.moduleId && this.rootKey);
  },

  useDlLayout: function () {
    return this && this.layout === 'dl';
  },

  selectId: function () {
    return 'rootLicensePicker-' + (this && this.rootKey);
  },

  currentLicense: function () {
    return getCurrentLicense(this && this.moduleId, this && this.rootKey);
  }
});

// The save lives on the WRAPPER, not on the shared select: Blaze event maps
// catch events bubbling out of child templates, so licenseCatalogSelect stays a
// presentational control that no consumer has to opt out of.
Template.rootComponentLicensePicker.events({
  'change .license-catalog-select': function (event, instance) {
    const ctx = (instance && instance.data) || {};
    if (!ctx.moduleId || !ctx.rootKey) return;
    const moduleId = ctx.moduleId;
    const rootKey = ctx.rootKey;
    const newLicense = event.target.value || '';

    const module = Modules.findOne(moduleId, {fields: {componentConfig: 1}});
    const currentList = (module && module.componentConfig && module.componentConfig.licensesSelected) || [];
    const originalData = _.clone(currentList);
    const remaining = _.reject(currentList, function (e) { return e && e.key === rootKey; });

    const user = Meteor.user();
    const now = new Date();
    const authorName = (user && user.profile && user.profile.name) ||
      (user && user.emails && user.emails[0] && user.emails[0].address) || 'user';

    let updatedList = remaining;
    if (newLicense) {
      updatedList = remaining.concat([{
        key: rootKey,
        license: newLicense,
        comment: 'Root component license picked by ' + authorName + ', ' + now.toLocaleDateString()
      }]);
    }

    Meteor.callAsync('updateCollection', 'Modules', moduleId,
      'componentConfig.licensesSelected', updatedList, true, originalData)
      .then(function () {
        return Modules.updateAsync(moduleId, {$set: {analysisRequired: true}});
      })
      .then(function () {
        Notify.success(newLicense
          ? 'Root component license set to "' + newLicense + '". Re-analysing…'
          : 'Root component license cleared. Re-analysing…');
        // Fire-and-forget: re-inject into latest scan + re-run analysis so the
        // dependency list reflects the new license without manual reprocess.
        Meteor.callAsync('Modules.PropagateLicensePicks', moduleId)
          .catch(function (error) {
            console.error('PropagateLicensePicks failed:', error);
          });
      })
      .catch(function (error) {
        console.error('rootComponentLicensePicker save error:', error);
        Notify.danger('Failed to save: ' + (error.reason || error.message));
      });
  }
});

/* global document:false */

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {matchVersions} from '/imports/client/ui/common/version-search/versionMatch';
import {Tracker} from 'meteor/tracker';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {initLicenseSelectsWhenLoaded} from '/imports/client/ui/common/license-selects';
import Utils from '/imports/lib/utils';
import Licenses from '/imports/lib/collections/licenses';
import Notify from '/imports/api/notify';

const SET_LICENSE = '#set-license-to-selected'

Template.cotsManagementComponentsEdit.onCreated(function () {
  this.versionFilter = new ReactiveVar('');
});

Template.cotsManagementComponentsEdit.onRendered(function () {
  Session.set('editField', '');
  Session.set('selectedVersions');
  Session.set('listUpdateActionInProgress');
  initLicenseSelectsWhenLoaded(this);
});

Template.cotsManagementComponentsEdit.helpers({
  versionFilter: function () {
    return Template.instance().versionFilter;
  },
  getVersionsMatching: function () {
    return matchVersions(this.getVersions(true), Template.instance().versionFilter.get());
  },
  isComponentLoaded: function () {
    // gate the view until the component doc is loaded (cold-load / new-tab safety):
    // when the context is undefined, mustaches like {{getField 'provider'}} throw
    // "No such function: getField"
    return !!(this && typeof this.data === 'function' && this.data());
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  getCommentForTextArea: function () {
    const text = this.getComment();
    return text && text.replace(/<br\s*\/?>/gi, '\n');
  },

  activeTab: function (tab) {
    let state = Router.current().route.getName();
    if (tab instanceof Array) {
      let anyState = _.some(tab, function (obj) {
        return obj === state;
      });
      return anyState ? 'active-tab active' : '';
    } else {
      return tab === state ? 'active-tab active ' : '';
    }
  },

  getAllLicenses: function (selectedKey) {
    const result = [];
    Licenses.find({}, {
      fields: {key: 1, name: 1},
      sort: {name: 1}
    }).forEach(function (license) {
      const l = _.clone(license);
      if (selectedKey === l.key) {
        l.selected = true;
      }
      result.push(l);
    });

    return result;
  },

  getDeclaredLicensesList: function (selectedKey) {
    const result = [];
    const list = _.map(this.getDeclaredLicenses(), function (license) {
      return license.key
    })
    Licenses.find({}, {
      fields: {key: 1, name: 1},
      sort: {name: 1}
    }).forEach(function (license) {
      const l = _.clone(license);
      if (selectedKey === l.key || list.indexOf(l.key) > -1) {
        l.selected = true;
      }
      result.push(l);
    });

    return result;
  },

  getEffectiveLicensesList: function (selectedKey) {
    const result = [];
    const list = _.map(this.getEffectiveLicenses(), function (license) {
      return license.key
    })
    Licenses.find({}, {
      fields: {key: 1, name: 1},
      sort: {name: 1}
    }).forEach(function (license) {
      const l = _.clone(license);
      if (selectedKey === l.key || list.indexOf(l.key) > -1) {
        l.selected = true;
      }
      result.push(l);
    });

    return result;
  },

  getConcludedLicensesList: function (selectedKey) {
    const result = [];
    const list = _.map(this.getConcludedLicenses(), function (license) {
      return license.key
    })
    Licenses.find({}, {
      fields: {key: 1, name: 1},
      sort: {name: 1}
    }).forEach(function (license) {
      const l = _.clone(license);
      if (selectedKey === l.key || list.indexOf(l.key) > -1) {
        l.selected = true;
      }
      result.push(l);
    });

    return result;
  },

  allowedLanguages: function () {
    return Utils.getAllowedLanguages
  },

  noSelectedVersions: function () {
    const list = Session.get('selectedVersions');
    return Session.get('listUpdateActionInProgress') || (!list || list.length < 1)
  },

  categorySettings: function () {
    return {
      id: 'category',
      name: 'category',
      placeholder: 'Enter a category...',
      tags: this.getCategory && typeof this.getCategory === 'function' && this.getCategory() || [],
      strict: false,
      allowDuplicates: false
    };
  },

  algorithmsSettings: function () {
    return {
      id: 'crypto_algorithms',
      name: 'algorithms',
      placeholder: 'Enter a algorithm...',
      tags: this.getAlgorithms && typeof this.getAlgorithms === 'function' && this.getAlgorithms() || [],
      strict: false,
      allowDuplicates: false
    };
  }
});

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function toggleAll(event, selector) {
  let checkboxes = document.getElementsByName(selector);
  for (let i = 0, n = checkboxes.length; i < n; i++) {
    checkboxes[i].checked = event.target.checked;
  }
  const content = $(event.target).closest('.component-version');
  let items = [];
  content.find('input[name=' + selector + ']:checked').each(function () {
    items.push(this.value);
  });
  Session.set('selected' + toTitleCase(selector), items);
}

function bulkUpdateLicense(componentId, licensesList, versionCopyright) {
  Meteor.callAsync(
    'updateCOTSComponentVersionLicense',
    componentId,
    Session.get('selectedVersions'),
    licensesList,
    versionCopyright,
    Utils.username()
  ).then(function() {
    Notify.success('Versions has been updated');
  }).catch(function(error) {
    let textError = 'Error: ' + (JSON.stringify(error) || ' could not update versions');
    Notify.danger(textError);
  }).finally(function() {
    $('.set-license-to-selected').val('');
    $(SET_LICENSE).val(null).trigger('change');
    $('.set-license-url-to-selected').val('');
    $('.set-copyright-to-selected').val('');
  })
}

function bulkCreateVersions(componentId, versions) {
  Meteor.callAsync('createCOTSComponentVersions', componentId, versions, Utils.username()).then(function() {
    Notify.success('Versions has been created');
  }).catch(function(error) {
    let textError = 'Error: ' + (JSON.stringify(error) || ' could not create versions');
    Notify.danger(textError);
  }).finally(function() {
    $('.create-versions-list').val('');
  })
}

Template.cotsManagementComponentsEdit.events = {
  'change .mark-selected-all': function (event) {
    Session.set('listUpdateActionInProgress', true);
    toggleAll(event, 'versions');
    Session.set('listUpdateActionInProgress');
  },
  'click .set-changes-to-selected': function (event) {
    Session.set('listUpdateActionInProgress', true);
    const container = $(event.target).closest('.bulk_update_versions');
    let licensesList = container.find(SET_LICENSE).val();
    let licenseUrl = container.find('.set-license-url-to-selected').val();
    if(licensesList && licensesList.length){
      licensesList = _.map(licensesList, function (licenseKeyData, licenseKeyIndex) {
        return {
          key: licenseKeyData,
          name: $(container.find(SET_LICENSE).find(':selected')[licenseKeyIndex]).text(),
          url: licenseUrl
        }
      });
    }
    let versionCopyright = container.find('.set-copyright-to-selected').val();
    const componentId = this._id;
    bulkUpdateLicense(componentId, licensesList, versionCopyright);
    Session.set('listUpdateActionInProgress');
  },
  'click .create-versions': function (event) {
    Session.set('listUpdateActionInProgress', true);
    const container = $(event.target).closest('.bulk_create_versions');
    let versionsList = container.find('.create-versions-list').val();
    const componentId = this._id;
    if(versionsList){
      bulkCreateVersions(componentId, versionsList);
    }else{
      Notify.danger('No versions defined.');
    }
    Session.set('listUpdateActionInProgress');
  },
  'blur #description': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#description').value;
    value = value && value.trim();

    if (value !== this.getDescription()) {
      this.setDescription(value, true);
      this.store(Utils.username());
    }
  },

  'blur #shortDescription': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#shortDescription').value;
    value = value && value.trim();

    if (value !== this.getShortDescription()) {
      this.setShortDescription(value, true);
      this.store(Utils.username());
    }
  },


  'blur #comment': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#comment').value;

    // trim blanks and replace <cr><nl> by html <br />
    value = value && value.trim().replace(/\r?\n/g, '<br />');

    if (value !== this.getComment()) {
      this.setComment(value, true);
      this.store(Utils.username());
    }
  },

  'blur #requirements_sw': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#requirements_sw').value;
    value = value && value.trim();

    if (value !== this.getRequirementsSW()) {
      this.setRequirementsSW(value, true);
      this.store(Utils.username());
    }
  },

  'blur #requirements_hw': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#requirements_hw').value;
    value = value && value.trim();

    if (value !== this.getRequirementsHW()) {
      this.setRequirementsHW(value, true);
      this.store(Utils.username());
    }
  },

  'blur #homepage': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#homepage').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getUrl('homepage')) {
      this.setUrl('homepage', value, true);
      this.store(Utils.username());
    }
  },

  'blur #repository': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#repository').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getUrl('repository')) {
      this.setUrl('repository', value, true);
      this.store(Utils.username());
    }
  },

  'blur #issues': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#issues').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getUrl('issues')) {
      this.setUrl('issues', value, true);
      this.store(Utils.username());
    }
  },

  'blur #notes': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#notes').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getUrl('notes')) {
      this.setUrl('notes', value, true);
      this.store(Utils.username());
    }
  },

  'blur #provider': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#provider').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getField('provider')) {
      this.setField('provider', value, true);
      this.store(Utils.username());
    }
  },

  'blur #providerUrl': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#providerUrl').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getField('providerUrl')) {
      this.setField('providerUrl', value, true);
      this.store(Utils.username());
    }
  },

  'blur #providerAddress': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#providerAddress').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getField('providerAddress')) {
      this.setField('providerAddress', value, true);
      this.store(Utils.username());
    }
  },

  'blur #declaredCopyright': function (evt, tmpl) {
    evt.preventDefault();

    let value = tmpl.find('#declaredCopyright').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }

    if (value !== this.getField('declaredCopyright')) {
      this.setField('declaredCopyright', value, true);
      this.store(Utils.username());
    }
  },

  'change #set-declared-licenses': function (evt, tmpl) {
    evt.preventDefault();

    let value = $(tmpl.find('#set-declared-licenses')).select2('data');
    value = _.map(value, function (license) {
      return {
        key: license.id,
        name: license.text,
        qos: 3
      }
    })
    if (!value || value.length === 0) {
      value = undefined;
    }

    if (value !== this.getField('declaredLicenses')) {
      this.setField('declaredLicenses', value, true);
      this.store(Utils.username());
    }
  },

  'change #set-effective-licenses': function (evt, tmpl) {
    evt.preventDefault();

    let value = $(tmpl.find('#set-effective-licenses')).select2('data');
    value = _.map(value, function (license) {
      return {
        key: license.id,
        name: license.text,
        qos: 3
      }
    })
    if (!value || value.length === 0) {
      value = undefined;
    }

    if (value !== this.getField('effectiveLicenses')) {
      this.setField('effectiveLicenses', value, true);
      this.store(Utils.username());
    }
  },

  'change #set-concluded-licenses': function (evt, tmpl) {
    evt.preventDefault();

    let value = $(tmpl.find('#set-concluded-licenses')).select2('data');
    value = _.map(value, function (license) {
      return {
        key: license.id,
        name: license.text,
        qos: 3
      }
    })
    if (!value || value.length === 0) {
      value = undefined;
    }

    if (value !== this.getField('concludedLicenses')) {
      this.setField('concludedLicenses', value, true);
      this.store(Utils.username());
    }
  },

  'click [name="licenseModel"]': function (evt) {
    const newVal = evt.target.value;
    if (newVal !== this.getField('licenseModel')) {
      this.setField('licenseModel', newVal);
      this.store(Utils.username());
    }
  },

  'click #comp-edit-descr': function () {
    Session.set('editField', Session.equals('editField', 'description') ? '' : 'description');
    Tracker.flush();
    $('#description').focus();
  },

  'click #comp-edit-comment': function () {
    Session.set('editField', Session.equals('editField', 'comment') ? '' : 'comment');
    Tracker.flush();
    $('#comment').focus();
  },

  'click #comp-edit-info': function () {
    Session.set('editField', Session.equals('editField', 'info') ? '' : 'info');
    Tracker.flush();
    $('#homepage').focus();
  },

  'click [name="optionsLang"]': function (evt) {
    const newVal = evt.target.value;
    const component = Template.parentData();
    if (newVal !== component.getLanguage()) {
      component.setLanguage(newVal, true);
      const user = Meteor.user();
      component.store(Utils.username(), false, user);
    }
  },

  'change #category': function (evt, tmpl) {
    evt.preventDefault();
    let parent = Template.parentData();
    let value = tmpl.find('#category').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }else{
      value = value.split(',');
    }
    if (value !== parent.getField('category')) {
      parent.setField('category', value);
      parent.store(Utils.username());
    }
  },

  'change #crypto_algorithms': function (evt, tmpl) {
    evt.preventDefault();
    let parent = Template.parentData();
    let value = tmpl.find('#crypto_algorithms').value;
    value = value && value.trim();
    if (value === '') {
      value = undefined;
    }else{
      value = value.split(',');
    }
    if (value !== parent.getField('crypto_algorithms')) {
      parent.setField('crypto_algorithms', value);
      parent.store(Utils.username());
    }
  }
};

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Spacebars} from 'meteor/spacebars';
import {Tracker} from 'meteor/tracker';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {moment} from 'meteor/momentjs:moment';
import {ComponentLicenseSchema} from '/imports/lib/schemas/componentSchema';
import Licenses from '/imports/lib/collections/licenses';
import License from '/imports/lib/component/License';
import Vulnerability from '/imports/lib/component/Vulnerability';
import Version from '/imports/lib/component/Version';
import QOS from '/imports/lib/component/QOS';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';
import COTSComponent from '/imports/lib/component/COTSComponent';
import InfrastructureComponent from '/imports/lib/component/InfrastructureComponent';

function validateField(schema, field, value) {

  const ctx = schema.newContext();
  const obj = {};
  obj[field] = value;
  ctx.validateOne(obj, field);
  if (ctx.isValid()) {
    return true;
  } else {
    Notify.danger('Invalid value for {0}: {1}', field, value);
    return false;
  }
}

Template.componentDetailsVersion.helpers({
  isVersionEditable: function (clazz) {
    if (!clazz || clazz instanceof Spacebars.kw) {
      clazz = true;
    }
    const version = this instanceof Version ? this : this.version;
    const state = Session.equals('editField', 'version-' + version.index);
    return state ? clazz : '';
  },

  getAllLicenses: function (selectedKey) {
    const result = [{name: 'undefined'}];
    let selectFound = false;
    Licenses.find({}, {
      fields: {key: 1, name: 1},
      sort: {name: 1}
    }).forEach(function (license) {
      const l = _.clone(license);
      if (selectedKey === l.key) {
        l.selected = true;
        selectFound = true;
      }
      result.push(l);
    });

    if (selectFound === false) {
      result[0].selected = true;
    }
    return result;
  },

  hasVuln: function () {
    const version = this;
    return Vulnerability.findAll(version.component.getKey(), version.getVersion()).length > 0;
  },

  getVuln: function () {
    const version = this;
    return Vulnerability.findAll(version.component.getKey(), version.getVersion());
  },
  getRef: function () {
    const vulnerability = this;
    return Router.url('vlCveByName', null, {query:{filter:  JSON.stringify({cve: vulnerability.getName()})}});
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  getLicenseIndex: function (index) {
    return index + 1
  }
});

Template.componentDetailsVersion.events({
  'change input[name=versions]': function (event) {
    const content = $(event.target).closest('.component-version');
    let selectedVersions = [];
    content.find('input[name=versions]:checked').each(function () {
      selectedVersions.push(this.value);
    });
    Session.set('selectedVersions', selectedVersions);
  },
  'click .comp-edit-version': function (event) {
    const v = 'version-' + this.index;
    Session.set('editField', Session.equals('editField', v) ? '' : v);
    Tracker.flush();
    $(event.currentTarget).closest('.component-version').find('.comp-edit-license').select2({
      placeholder: 'Select license',
      width: '100%'
    });
  },
  'click .comp-remove-version': function (event) {
    event.preventDefault();
    const version = this.getVersion();
    const componentId = this.component._id;
    const isInfrastructure = this.component instanceof InfrastructureComponent ? 'InfrastructureComponent' : '';
    let collection = this.component instanceof COTSComponent ? 'COTSComponent' : isInfrastructure;
    Meteor.callAsync('remove'+(collection)+'Version', componentId, version, Utils.username()).then(function() {
      Notify.success('Version '+version+' has been deleted');
    }).catch(function(error) {
      let textError = 'Error: ' + (JSON.stringify(error) || ' could not delete version');
      Notify.danger(textError);
    })
  },
  'click .comp-edit-lic-verified': function () {
    if (Session.equals('editField', 'version-' + this.version.index)) {
      const oldValue = this.getQos();
      if (oldValue === QOS.HUMAN) {
        this.setQos(QOS.NOT_CHECKED);
      } else {
        this.setQos(QOS.HUMAN);
      }
      this.version.component.store(Utils.username());
    }
  },
  'click .comp-edit-chksum-verified': function () {
    if (Session.equals('editField', 'version-' + this.version.index)) {
      const oldValue = this.getQos();
      if (oldValue === QOS.HUMAN) {
        this.setQos(QOS.NOT_CHECKED);
      } else {
        this.setQos(QOS.HUMAN);
      }
      this.version.component.store(Utils.username());
    }
  },

  'blur #releaseDate': function (event, instance) {
    event.preventDefault();

    const value = instance.find('#releaseDate').value;
    const oldValue = moment(this.getReleaseDate()).format('YYYY-MM-DD');
    if (value != oldValue) {
      this.setReleaseDate(new Date(value));
      this.component.store(Utils.username());
    }
  },

  'blur .copyright_text': function (event, instance) {
    event.preventDefault();

    const value = instance.find('.copyright_text').value;
    this.setCopyright(value);
    this.component.store(Utils.username());
  },

  /**
   * this may point to License-object
   */
  'blur .license_url': function (event) {
    event.preventDefault();

    const value =  $(event.target).closest('td').find('.license_url').val();

    if (value && value.length > 0) {
      if (validateField(ComponentLicenseSchema, 'url', value)) {
        this.setUrl(value);
        this.version.component.store(Utils.username());
      }
    } else {
      this.setUrl(null);
      this.version.component.store(Utils.username());
    }
  },

  /**
   * this may point to License- (in case of modification), or to a Version-object (in case of addition)
   */
  'change .comp-edit-license': function (event) {
    const selected = $(event.target).find('option:selected')[0];
    const selectedKey = selected.value;
    const selectedName = selected.text;

    if (this instanceof License) { // modifiy existing
      const oldLicense = this;
      const version = oldLicense.version;

      if (selectedKey !== oldLicense.getKey()) {  // change happened
        if (selectedKey !== undefined && selectedKey !== 'undefined') {
          if (version.findLicense(selectedKey)) {
            Notify.danger(`License '${selectedName}' already selected for this version`);
            $(event.target).val(oldLicense.getKey() || 'undefined');
          } else {
            const license = version.getLicense(oldLicense.getKey());
            license.setKey(selectedKey);
            license.setName(selectedName);
            license.setQos(QOS.HUMAN);
            version.component.store(Utils.username());
          }
        } else {
          version.removeLicense(this.index);
          version.component.store(Utils.username());
        }
      }
    } else {                    // add additional license
      const version = this;

      if (selectedKey !== undefined && selectedKey !== 'undefined') {
        if (version.findLicense(selectedKey)) {
          Notify.danger(`License '${selectedName}' already selected for this version`);
          $(event.target).val('undefined');
        } else {
          const license = version.getLicense(selectedKey);
          license.setName(selectedName);
          license.setQos(QOS.HUMAN);
          version.component.store(Utils.username());
          $(event.target).val('undefined');
        }
      }
    }
  },

  /**
   * this may point to License- (in case of modification), or to a Version-object (in case of addition)
   */
  'click .comp-remove-license': function (event) {
    event.preventDefault();
    const oldLicense = this;
    const version = oldLicense.version;
    version.removeLicense(this.index);
    version.component.store(Utils.username());

  }
});


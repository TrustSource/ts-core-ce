/* global document:false window:false Blob:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import i18n from 'meteor/universe:i18n';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';

const FROM_UPPER = 'from-upper'

// Per-asset-type one-line summary so the list shows meaningful details for every
// asset type (algorithm/certificate/protocol/related-crypto-material), not just the
// algorithm-only columns that were blank for the other three types.
function cryptoDetailsSummary(object) {
  if (!object) return '';
  const type = object.assetType || 'algorithm';
  const parts = [];
  const push = function (label, value) {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      value = value.join(', ');
    }
    parts.push(label + ': ' + value);
  };
  if (type === 'certificate') {
    const p = object.certificateProperties || {};
    push('subject', p.subjectName);
    push('format', p.certificateFormat);
    push('state', p.certificateState);
  } else if (type === 'protocol') {
    const p = object.protocolProperties || {};
    push('type', p.type);
    push('version', p.version);
  } else if (type === 'related-crypto-material') {
    const p = object.relatedCryptoMaterialProperties || {};
    push('type', p.type);
    push('state', p.state);
    push('size', p.size);
  } else {
    const p = object.algorithmProperties || {};
    push('primitive', p.primitive);
    push('mode', p.mode);
    push('functions', p.cryptoFunctions);
    push('certification', p.certificationLevel);
  }
  return parts.join(' · ');
}

// The parameter of a detected algorithm (key size), or '' when none is known.
function strengthLabel(strength) {
  if (Array.isArray(strength)) {
    return _.uniq(strength.filter((value) => value !== null && value !== undefined && value !== '')).join(', ');
  }
  return strength === null || strength === undefined ? '' : String(strength);
}

Template.algorithmsSettingsList.helpers({
  // One entry per algorithm and parameter: on a project the same algorithm is
  // detected once per module.
  uniqueFoundAlgorithms: function () {
    const found = Template.currentData().foundAlgorithms || [];
    return _.uniq(found.map(function (item) {
      return Object.assign({}, item, {strengthLabel: strengthLabel(item.strength)});
    }), false, function (item) {
      return item.algorithm + '|' + item.strengthLabel;
    });
  },
  reactiveTableSettings: function () {
    const data = Template.currentData();
    return {
      collection: data.data,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Added',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'blacklisted',
          key: 'blacklisted',
          sortable: false,
          label: 'B',
          tmpl: Template.reactiveTableAlgorithmsBlacklistedStatus
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          fn: function (value, object) {
            return object.name || '_id: ' + object._id;
          }
        },
        {
          fieldId: 'assetType',
          key: 'assetType',
          label: i18n.__('AssetType'),
          fn: function (value) {
            return value || 'algorithm';
          }
        },
        {
          fieldId: 'details',
          key: 'assetType',
          sortable: false,
          label: i18n.__('Details'),
          fn: function (value, object) {
            return cryptoDetailsSummary(object);
          }
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment'
        },
        {
          fieldId: 'used',
          key: 'used',
          label: 'In use',
          tmpl: Template.reactiveTableAlgorithmsSettingsCheck,
          cellClass: 'col-40',
          fn: function (value) {
            return value
          },
          sortFn: function (value) {
            return value
          }
        },
        {
          fieldId: '_id',
          key: '_id',
          label: '_id',
          hidden: true
        },
        {
          fieldId: 'actions',
          key: 'actions',
          sortable: false,
          label: ' ',
          tmpl: Template.reactiveTableAlgorithmsSettingsActions
        }
      ]
    };
  },
  getList: function () {
    const data = Template.currentData();
    return data && data.data;
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  isDenied: function () {
    const company = Session.get('company');
    let self = this
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.algorithm){
          return false;
        }
        return algorithm.key.toLowerCase() === self.algorithm.toLowerCase();
      })
    }else{
      return false
    }
  }
});

Template.algorithmsSettingsList.events({
  'click .add-algorithm': function () {
    // Ensure the shared modal opens in "add" mode, not inheriting a prior edit.
    Session.set('cryptoEditItem', null);
  },
  'click .export-as-cyclonedx-cbom': function () {
    exportCycloneDx('CBOM', '-cbom-file-0.1.0.json');
  },
  'click .export-as-cyclonedx-full': function () {
    exportCycloneDx(undefined, '-full-cyclonedx-0.1.0.json');
  }
});

// Export the module's BOM as CycloneDX. `variant` is 'CBOM' for the crypto-only document or
// undefined for the combined "Full BOM" (software components + crypto assets + AI artifacts).
function exportCycloneDx(variant, suffix) {
  const company = Session.get('company');
  Meteor.callAsync('getProjectSBOM', Router.current().params.projectId, company._id, Router.current().params.moduleId).then((data) =>{
    if(data){
      let user = Meteor.user();
      let { list, tree, project, module, company, cryptoProperties, aiProperties} = data
      let componentsCount = list.length;
      let completedActivity = 0;
      _.each(list, function (component) {
        if (component.completed) {
          completedActivity = completedActivity + 1
        }
      });
      const totalActivity = (componentsCount || 0) ;
      let doc = {
        created: new Date(),
        version: '1.0.0',
        company,
        companyId: company._id,
        project,
        projectId: project._id,
        moduleId: module && module._id,
        userId: user._id,
        userName: ((user.profile && user.profile.name)
          || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email)),
        components: componentsCount,
        completed: completedActivity && totalActivity ? Math.round((completedActivity/totalActivity) * 100) : 0,
        totalActivity: totalActivity,
        completedActivity: completedActivity,
        disabled: false,
        list,
        tree,
        cryptoProperties,
        aiProperties
      };
      let report = reportSbomFileService.getCycloneDxDetails(doc, variant);
      let blob = new Blob([JSON.stringify(report, null, 2)]);
      if (window.navigator.msSaveOrOpenBlob)
        window.navigator.msSaveBlob(blob, getSbomName(data)+suffix);
      else{
        let a = window.document.createElement('a');
        a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
        a.download = getSbomName(data)+suffix;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  }).catch(function(error) {
    Notify.danger(error.reason || error.message || 'Could not export CycloneDX');
  })
}


function getSbomName(file) {
  return file.module ? file.module.name || 'Module is N.A.'
    : file.project && file.project.name || 'Project is N.A.'
}


Template.reactiveTableAlgorithmsSettingsActions.events({
  'click .edit-algorithm': function (event) {
    event.preventDefault();
    // Hand the row to the shared add/edit modal, which switches into edit mode.
    Session.set('cryptoEditItem', this);
    $('#AlgorithmsSettingsAddModal').modal('show');
  },
  'click .remove-algorithm': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const allData = Session.get('getAlgorithmSettingsList')
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        return elem._id === self._id;
      }) || [];
      Meteor.callAsync('CryptoProperties.Remove', self._id).then(function() {
        Notify.success('Successfully removed');
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not remove');
      });
      Session.set('getAlgorithmSettingsList', dataWithout);
    }
  }
});

Template.reactiveTableAlgorithmsSettingsActions.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  isFromModule: function () {
    return this.moduleItem ? FROM_UPPER : ''
  },

  isFromProject: function () {
    return this.projectItem ? FROM_UPPER : ''
  },

  isFromCompany: function () {
    return this.companyItem ? FROM_UPPER : ''
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  getModuleOptions: function () {
    return {
      projectId: Router.current().params.projectId,
      moduleId: this.moduleId
    };
  }
});

Template.reactiveTableAlgorithmsSettingsCheck.helpers({
  getCheck: function () {
    let settings = Template.parentData()
    return this && this[settings.fieldId] === true
  }
});

Template.reactiveTableAlgorithmsBlacklistedStatus.helpers({
  isDenied: function () {
    const company = Session.get('company');
    let self = this;
    if(company && company.blacklistedAlgorithms && company.blacklistedAlgorithms.length){
      return company.blacklistedAlgorithms.some(algorithm => {
        if(!algorithm.key || !self.name){
          return false;
        }
        return algorithm.key.toLowerCase() === self.name.toLowerCase();
      })
    }else{
      return false
    }
  }
});

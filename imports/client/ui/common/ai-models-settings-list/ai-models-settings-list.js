/* global document:false window:false Blob:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import reportSbomFileService from '/imports/lib/reports/reportSbomFileService';

const FROM_UPPER = 'from-upper'

// One-line summary of the structured AI fields, so the list shows meaningful detail.
function aiDetailsSummary(object) {
  if (!object) return '';
  const parts = [];
  const push = function (label, value) {
    if (value === undefined || value === null || value === '') return;
    parts.push(label + ': ' + value);
  };
  push('provider', object.provider);
  push('task', object.task);
  push('family', object.modelFamily);
  push('architecture', object.architecture);
  return parts.join(' · ');
}

Template.aiModelsSettingsList.helpers({
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
          fieldId: 'name',
          key: 'name',
          label: 'Name',
          fn: function (value, object) {
            return object.name || '_id: ' + object._id;
          }
        },
        {
          fieldId: 'version',
          key: 'version',
          label: 'Version'
        },
        {
          fieldId: 'details',
          key: 'provider',
          sortable: false,
          label: 'Details',
          fn: function (value, object) {
            return aiDetailsSummary(object);
          }
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment'
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
          tmpl: Template.reactiveTableAiModelsSettingsActions
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
  }
});

// Export the module's BOM as CycloneDX. `variant` is undefined for the combined
// "Full BOM" (software components + crypto assets + AI artifacts) or 'AIBOM' for the
// AI-only document. `suffix` is appended to the downloaded file name.
function exportCycloneDx(variant, suffix) {
  const company = Session.get('company');
  Meteor.callAsync('getProjectSBOM', Router.current().params.projectId, company._id, Router.current().params.moduleId).then((data) => {
    if(data){
      let user = Meteor.user();
      let {list, tree, project, module, company, cryptoProperties, aiProperties} = data
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
        components: list.length,
        disabled: false,
        list,
        tree,
        cryptoProperties,
        aiProperties
      };
      let report = reportSbomFileService.getCycloneDxDetails(doc, variant);
      let blob = new Blob([JSON.stringify(report, null, 2)]);
      if (window.navigator.msSaveOrOpenBlob)
        window.navigator.msSaveBlob(blob, getBomName(data)+suffix);
      else{
        let a = window.document.createElement('a');
        a.href = window.URL.createObjectURL(blob, {type: 'application/json'});
        a.download = getBomName(data)+suffix;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  }).catch(function(error) {
    Notify.danger(error.reason || error.message || 'Could not export CycloneDX');
  })
}

Template.aiModelsSettingsList.events({
  'click .add-ai-model': function () {
    // Ensure the shared modal opens in "add" mode, not inheriting a prior edit.
    Session.set('aiEditItem', null);
  },
  'click .export-as-cyclonedx-aibom': function () {
    exportCycloneDx('AIBOM', '-aibom-file-0.1.0.json');
  },
  'click .export-as-cyclonedx-full': function () {
    exportCycloneDx(undefined, '-full-cyclonedx-0.1.0.json');
  }
});

function getBomName(file) {
  return file.module ? file.module.name || 'Module is N.A.'
    : file.project && file.project.name || 'Project is N.A.'
}

Template.reactiveTableAiModelsSettingsActions.events({
  'click .edit-ai-model': function (event) {
    event.preventDefault();
    // Hand the row to the shared add/edit modal, which switches into edit mode.
    Session.set('aiEditItem', this);
    $('#AiModelsSettingsAddModal').modal('show');
  },
  'click .remove-ai-model': function (event) {
    event.preventDefault();
    $('.highlight').removeClass('highlight');
    const self = this;
    const allData = Session.get('getAiModelsSettingsList')
    if (allData instanceof Array) {
      const dataWithout = _.reject(allData, function (elem) {
        return elem._id === self._id;
      }) || [];
      Meteor.callAsync('AiProperties.Remove', self._id).then(function() {
        Notify.success('Successfully removed');
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not remove');
      });
      Session.set('getAiModelsSettingsList', dataWithout);
    }
  }
});

Template.reactiveTableAiModelsSettingsActions.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  isFromModule: function () {
    return this.moduleItem ? FROM_UPPER : ''
  },
  getModuleOptions: function () {
    return {
      projectId: Router.current().params.projectId,
      moduleId: this.moduleId
    };
  }
});

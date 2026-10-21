import {Spacebars} from 'meteor/spacebars';
import {escapeHtml} from '/imports/client/ui/helpers/template-helpers';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import SPDXImportsFind from '/imports/lib/interactors/SPDXImports/find';
import ModuleImportsFind from '/imports/lib/interactors/moduleImports/find';
import ModuleImports from '/imports/lib/collections/moduleImports';

 
Template.ModuleImportTab.helpers({
  currentProject: function () {
    let parent = Template.parentData();
    let current = Template.currentData();
    return current && current.moduleCount ? current : parent
  },
  hasSPDX: function () {
    const projectId = Router.current().params.projectId;
    return SPDXImportsFind({projectId}).length
  },
  hasImports: function () {
    const projectId = Router.current().params.projectId;
    return ModuleImportsFind({projectId}).length
  },
  reactiveTableSettings: function ()  {
    const projectId = Router.current().params.projectId;
    return {
      collection: SPDXImportsFind({projectId}),
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: '_id',
          key: '_id',
          label: 'ID',
          fn: function (value, object) { return object._id; }
        },
        {
          fieldId: 'originalId',
          key: 'originalId',
          label: 'File',
          fn: function (value, object) {
            return object.originalId ?
              new Spacebars.SafeString(`<a href="${object.original().url()}" target="_blank" download>Download</a>`) :
              null;
          }
        },
        {
          fieldId: 'scanId',
          key: 'scanId',
          label: 'Scan',
          fn: function (value, object) {
            return object.scanId ?
              new Spacebars.SafeString(`<a href="${Router.routes['scanDetail'].path({_id: object.scanId})}">${object.scanId}</a>`) :
              null;
          }
        },
        {
          fieldId: 'status',
          key: 'status',
          label: 'Status',
          fn: function (value, object) { return object.status; }
        },
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        }
      ]
    };
  },
  reactiveTableSettingsImports: function ()  {
    const projectId = Router.current().params.projectId;
    return {
      collection: ModuleImportsFind({projectId}),
      rowsPerPage: 15,
      showFilter: false,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: '_id',
          key: '_id',
          label: 'ID',
          fn: function (value, object) { return object._id; }
        },
        {
          fieldId: 'type',
          key: 'type',
          label: 'Type',
          fn: function (value, object) { return object.meta && object.meta.type; }
        },
        {
          fieldId: 'originalId',
          key: 'originalId',
          label: 'File',
          fn: function (value, object) {
            if(object.versions && object.versions.original && object.versions.original.path){
              const file = ModuleImports.findOne(object._id)
              return new Spacebars.SafeString(`<a href="${file.link()}" target="_blank" download>Download</a>`);
            }
            return null
          }
        },
        {
          fieldId: 'scanId',
          key: 'scanId',
          label: 'Scan',
          fn: function (value, object) {
            if(object.meta && object.meta.reason && !object.meta.scanId){
              const reason = escapeHtml(object.meta.reason)
              return new Spacebars.SafeString(`<span title="${reason}">
<span class="fa fa-exclamation-triangle"></span> ${reason}</span>`)
            }
            return object.meta && object.meta.scanId ?
              new Spacebars.SafeString(`<a href="${Router.routes['scanDetail']
                .path({_id: object.meta.scanId})}">${object.meta.scanId}</a>`) :
              null;
          }
        },
        {
          fieldId: 'status',
          key: 'status',
          label: 'Status',
          fn: function (value, object) {
            if(object.meta && object.meta.reason){
              const reason = escapeHtml(object.meta.reason)
              const status = escapeHtml(object.meta.status)
              return new Spacebars.SafeString(`<span title="${reason}">
${status} <span class="fa fa-exclamation-triangle"></span></span>`)
            }
            return object.meta && object.meta.status;
          }
        },
        {
          fieldId: 'created',
          key: 'meta.created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        }
      ]
    };
  }
});
 

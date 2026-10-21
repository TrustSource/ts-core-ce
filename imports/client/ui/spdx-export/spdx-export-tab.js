import {Meteor} from 'meteor/meteor';
import {Spacebars} from 'meteor/spacebars';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';
import SPDXExportsFind from '/imports/lib/interactors/SPDXExports/find';

 
Template.SPDXExportTab.helpers({
  currentModule: function () {
    let moduleParent = Template.parentData();
    let moduleCurrent = Template.currentData();
    return moduleCurrent && moduleCurrent.moduleIdentifier ? moduleCurrent : moduleParent
  },

  reactiveTableSettings: function ()  {
    const moduleId = Router.current().params.moduleId;
    const moduleCurrent = Template.currentData();
    const moduleData = (moduleCurrent && moduleCurrent.moduleIdentifier)
      ? moduleCurrent
      : Template.parentData();
    const documentName = ((moduleData && moduleData.name) || 'spdx').replace(/[^a-zA-Z0-9.-]/g, '-');
    return {
      collection: SPDXExportsFind({moduleId}),
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: '_id',
          key: '_id',
          label: 'ID',
          fn: function (value, object) { return object._id; }
        },
        {
          fieldId: 'rdfFileId',
          key: 'rdfFileId',
          label: 'RDF',
          fn: function (value, object) {
            if (object.rdfFileId && object.uuid) {
              const href = Router.path('SPDXExport', {documentName, uuid: object.uuid});
              return new Spacebars.SafeString(`<a href="${href}" target="_blank" download>Download RDF</a>`);
            }
            return null;
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
  }
});

Template.SPDXExportTab.events({
  'click #SPDXExportTabGenerate': function (event) {
    event.preventDefault();
    const userId = Meteor.user()._id;
    const moduleId = Router.current().params.moduleId;
    Meteor.callAsync('SPDXExports.Create', {userId, moduleId}).then(function() {
      Notify.success('SPDX generation successfully added to queue!');
    }).catch(function(error) {
      Notify.danger('Error: ' + (error.reason || ' could not add to queue!'));
    });
  }
});
 

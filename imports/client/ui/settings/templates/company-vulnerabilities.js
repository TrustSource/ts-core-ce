import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Notify from '/imports/api/notify';

Template.companyManualVulnerabilities.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.companyManualVulnerabilities.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.companyManualVulnerabilities.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this,
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'severity',
          key: 'severity',
          label: 'Severity',
          fn: function (value, object) {
            return object.vuln.severity;
          }
        },
        {
          fieldId: 'fileName',
          key: 'fileName',
          label: 'Component',
          fn: function (value, object) {
            return (object.fileName) + ' (' + object.vuln.vulnerableSoftware.map(function (vuln) {
              return vuln.version
            }).join(',') + ')';
          }
        },
        {
          fieldId: 'key',
          key: 'key',
          label: 'Key',
          fn: function (value, object) {
            return object.vuln.key;
          }
        },
        {
          fieldId: 'description',
          key: 'description',
          label: 'Description',
          fn: function (value, object) { return object.vuln.description; }
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'Creator',
          cellClass: 'col-sender',
          fn: function (value, object) { return object.userName; }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableManualVulnerabilitiesActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableManualVulnerabilitiesActions.events({
  'click .remove': function (event) {
    event.preventDefault();
    const {key} = this;
    Meteor.callAsync('ManualVulnerabilities.Remove', this._id).then(function() {
      const message = 'Manual vulnerability '+key+' removed';
      Notify.success(message);
    }).catch(function(error) {
      const message = 'Internal Error: ' + (error.reason || 'could not remove vulnerability');
      Notify.danger(message);
    })
  }
});

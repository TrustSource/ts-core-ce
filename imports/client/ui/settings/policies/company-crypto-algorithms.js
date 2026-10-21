import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.companyCryptoAlgorithms.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.companyCryptoAlgorithms.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.companyCryptoAlgorithms.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this.key) {
      Router.go('reportImpactAlgorithm', {}, {query: {key: this.key, strength: this.strength}});
    }
  }
});

Template.companyCryptoAlgorithms.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this.blacklistedAlgorithms || [],
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
          fieldId: 'key',
          key: 'key',
          label: 'Key'
        },
        {
          fieldId: 'strength',
          key: 'strength',
          label: 'Strength'
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment'
        },
        {
          fieldId: 'createdBy',
          key: 'createdBy',
          label: 'Added by'
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableCompanyCryptoAlgorithmsActions,
          cellClass: 'col-actions'
        }
      ]
    };
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  hasList: function () {
    let list = this.blacklistedAlgorithms || []
    return list.length > 0
  }
});

Template.reactiveTableCompanyCryptoAlgorithmsActions.events({
  'click .remove-algorithm': function () {
    const self = this;
    Meteor.callAsync('blacklistedAlgorithms.delete', self.key).then(function() {
      const user = Meteor.user();
      Notify.success('Blacklisted algorithm deleted');
      Meteor.callAsync('logEvent', user, 'Blacklisted algorithm '+self.key+' deleted', 'blacklistedAlgorithmsProcessing');
    }).catch(function(error) {
      const user = Meteor.user();
      Notify.danger(error.message);
      Meteor.callAsync('logEvent', user, 'Error: ' + error.message, 'blacklistedAlgorithmsProcessing');
    });
  }
});


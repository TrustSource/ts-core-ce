 
/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Spacebars} from 'meteor/spacebars';
import {Router} from 'meteor/vlasky:galvanized-iron-router';

import Notify from '/imports/api/notify';
import UserExtUtils from '/imports/lib/userExtUtils';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';


Template.policyList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  $('.panel-body').tooltip({
    selector: '[data-toggle=tooltip]'
  });
});

Template.policyList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.policyList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('policyDetails', {policyId: this._id});
    }
  }
});

Template.policyList.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  reactiveTableSettings: function () {
    return {
      collection: this,
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'active',
          key: 'active',
          label: 'Active',
          fn: function (value) {
            return (value) ? 'yes' : 'no';
          }
        },
        {
          fieldId: 'activeFromDate',
          key: 'activeFromDate',
          label: 'Active from',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'creationDate',
          key: 'creationDate',
          label: 'Created',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'updatedDate',
          key: 'updatedDate',
          label: 'Updated',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Policy name'
        },
        {
          fieldId: 'file',
          key: 'file',
          label: 'Document',
          fn: function (value, object) {
            if(object.file && object.fileData()){
              if(object.fileData().url()){
                return new Spacebars.SafeString(`<a href="${object.fileData().url()}" target="_blank" download>Download</a>`)
              }else{
                return 'Upload in progress'
              }
            }else{
              return 'No file'
            }
          }
        },
        {
          fieldId: 'notify',
          key: 'notify',
          label: 'Notify',
          fn: function (value) {
            let options = UserExtUtils.availableRolesWithValues();
            let mapped = _.filter(_.map(value,function (valueItem) {
              let opt = _.find(options,function (item) {
                return item.value === valueItem
              })
              return opt && opt.label
            }),function (item) {
              return item
            });
            return new Spacebars.SafeString('<span sort=' + mapped + '>' + mapped.join(', ') + '</span>');
          }
        },
        {
          fieldId: 'presented',
          key: 'presented',
          label: 'Presented',
          fn: function (value,object) {
            let allUsers = ReactiveMethod.call('getUsersCount', object.notify);
            let presented = _.filter(object.notified,function (userItem) {
              return userItem.presentedDate && !userItem.confirmedDate
            });
            let confirmed = _.filter(object.notified,function (userItem) {
              return userItem.confirmedDate
            });
            let total = (presented && presented.length || 0)+(confirmed && confirmed.length || 0);
            return new Spacebars.SafeString('<span sort=' + total + '>' + total + (_.isNumber(allUsers) ? `/${allUsers}` : '') + '</span>');
          }
        },
        {
          fieldId: 'viewed',
          key: 'viewed',
          label: 'Viewed',
          fn: function (value,object) {
            let allUsers = ReactiveMethod.call('getUsersCount', object.notify);
            let viewed = _.filter(object.notified,function (userItem) {
              return userItem.viewedDate
            });
            let total = (viewed && viewed.length || 0);
            return new Spacebars.SafeString('<span sort=' + total + '>' + total + (_.isNumber(allUsers) ? `/${allUsers}` : '') + '</span>');
          }
        },
        {
          fieldId: 'confirmed',
          key: 'confirmed',
          label: 'Confirmed',
          fn: function (value,object) {
            let allUsers = ReactiveMethod.call('getUsersCount', object.notify);
            let confirmed = _.filter(object.notified,function (userItem) {
              return userItem.confirmedDate
            });
            let count = confirmed && confirmed.length || 0;
            return new Spacebars.SafeString('<span sort=' + count + '>' + count + (_.isNumber(allUsers) ? `/${allUsers}` : '') + '</span>');
          }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTablePolicyActions
        }
      ]
    };
  }
});

Template.reactiveTablePolicyActions.events({
  'click .delete-policy': function (event) {
    event.preventDefault();
    const user = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to delete policy ' + self.name + '?',
      text: 'You will not be able to recover this policy!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('Policy.Remove', self._id).then(function() {
        let message = 'Policy '+self.name+' has been deleted';
        Meteor.callAsync('logEvent', user, message, 'policyDeleted');
        Notify.success(message);
        Router.go('policyList');
      }).catch(function(err) {
        let textError = 'Error: policy ' + self.name + ' not deleted: ' + err;
        Meteor.callAsync('logEvent', user, textError, 'policyDeleted');
        Notify.danger(textError);
      });
    });
  }
});
Template.reactiveTablePolicyActions.helpers({
  possibleRemove: function () {
    return !this.notified || this.notified && this.notified.length < 2
  }
});

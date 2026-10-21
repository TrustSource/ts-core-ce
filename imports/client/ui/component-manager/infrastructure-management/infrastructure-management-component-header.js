/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Notify from '/imports/api/notify';

const IE = 'Internal Error! Component: '
const COMP = 'Component: '
const INFRASTRUCTURE = 'Infrastructure component '

Template.infrastructureManagementComponentsHeader.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
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

  routeParams: function () {
    return { _id : Router.current().params._id }
  }
});

Template.infrastructureManagementComponentsHeader.events = {
  'click #component-delete': function (event) {
    event.preventDefault();
    const self = this;
    const name = self.getName();

    swal({
      title: 'Are you sure you want to delete component ' + name + '?',
      text: 'You will not be able to recover component!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, delete it!'
    }, function () {
      Meteor.callAsync('InfrastructureComponents.Remove', self._id).then(function() {
        const user = Meteor.user();
        Meteor.callAsync('logEvent', user, INFRASTRUCTURE+name+' deleted', 'infrastructureComponentDeleted');
        Notify.success(COMP + name + ' deleted');
        Router.go('infrastructureComponentsList');
      }).catch(function(err) {
        const user = Meteor.user();
        const message = IE + name + ' not deleted: ' + err;
        Meteor.callAsync('logEvent', user, message, 'infrastructureComponentDeleted');
        Notify.danger(message);
      });
    });
  },
  'click #component-soft-delete': function (event) {
    event.preventDefault();
    const self = this;
    const name = self.getName();

    swal({
      title: 'Are you sure you want to soft-delete component ' + name + '?',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, soft-delete it!'
    }, function () {
      Meteor.callAsync('InfrastructureComponents.SoftRemove', self._id).then(function(data) {
        const user = Meteor.user();
        if (data !== 1) {
          const message = IE + name + ' not deleted';
          Meteor.callAsync('logEvent', user, message, 'infrastructureComponentDeleted');
          Notify.danger(message);
        } else {
          Meteor.callAsync('logEvent', user, INFRASTRUCTURE+name+' soft-deleted', 'infrastructureComponentDeleted');
          Notify.success(COMP + name + ' soft-deleted');
        }
      });
    });
  },
  'click #component-soft-delete-undo': function (event) {
    event.preventDefault();
    const self = this;
    const name = self.getName();

    swal({
      title: 'Are you sure you want to revert delete component ' + name + '?',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, revert it!'
    }, function () {
      Meteor.callAsync('InfrastructureComponents.SoftRemoveUndo', self._id).then(function(data) {
        const user = Meteor.user();
        if (data !== 1) {
          const message = IE + name + ' not reverted';
          Meteor.callAsync('logEvent', user, message, 'infrastructureComponentDeleted');
          Notify.danger(message);
        } else {
          Meteor.callAsync('logEvent', user, INFRASTRUCTURE+name+' reverted', 'infrastructureComponentDeleted');
          Notify.success(COMP + name + ' reverted');
        }
      });
    });
  }
};

/* global document:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';


Template.csafDetailsJson.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('csafDetailsViewType')
});

Template.csafDetailsJson.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.csafDetailsJson.events({
  'click .change_view_type:not([disabled])': function (event) {
    event.preventDefault();
    Session.set('csafDetailsViewType', !Session.get('csafDetailsViewType'))
  },
  'click .save_changes:not([disabled])': function (event) {
    event.preventDefault();
    const self = this;
    const newData = $(event.target).closest('.json_view').find('[name="updatedData"]').val();
    Session.set('requestInProgress', true);
    Meteor.callAsync('CSAF.Validate', {file: newData}).then(function() {
      Meteor.callAsync('CSAF.Update', {$set: {data: newData}}, self._id).then(function() {
        Notify.success('CSAF ' + self.name + ' has been updated');
      }).catch(function(error) {
        Notify.danger(error.message);
      }).finally(function() {
        Session.set('requestInProgress');
      })
    }).catch(function(error) {
      Notify.danger(error.message);
      Session.set('requestInProgress');
    })
  }
});

Template.csafDetailsJson.helpers({
  isEditView: function () {
    return Session.get('csafDetailsViewType') === true
  },
  isEditDisabled: function () {
    return false
  },
  isLoading: function () {
    return Session.get('requestInProgress');
  }
});

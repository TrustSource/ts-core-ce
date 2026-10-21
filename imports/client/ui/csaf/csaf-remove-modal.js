import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';
import {$} from 'meteor/jquery';

const LOADING = 'loadingInProgress'

Template.CSAFRemoveModal.onRendered(function () {
  // Modals are moved to <body> on show (global handler) - Template.events
  // never fires inside. Bind delegated handlers on the modal element itself.
  $('#CSAFRemoveModal').off('.CSAFRemoveModal')
    .on('submit.CSAFRemoveModal', '#CSAFRemoveForm', function (event) {
      event.preventDefault();
      let target = Session.get('CSAFRemove')
      // Set the flag, do not clear it: the template swaps the submit button for a
      // disabled one while this is true, which is what stops a second click firing
      // CSAF.Remove again before the first call returns.
      Session.set(LOADING, true)
      if (target) {
        target = JSON.parse(target)
      }
      const form = '#CSAFRemoveForm'
      const params = {
        unmuteVulnerabilities: $(form).find('#task1').is(':checked'),
        openRisks: $(form).find('#task2').is(':checked')
      }
      Meteor.callAsync('CSAF.Remove', target._id, null, params).then(function() {
        Notify.success('CSAF '+target.name+' has been removed successfully');
        $('#CSAFRemoveModal').modal('hide');
        Meteor.setTimeout(function () {
          Router.go('csafList');
        },500)
      }).catch(function(error) {
        Notify.danger(error.message);
      }).finally(function() {
        Session.set(LOADING)
      })
    })
    .on('show.bs.modal.CSAFRemoveModal', function () {
      $('#CSAFRemoveForm').validate().resetForm();
    });
});

Template.CSAFRemoveModal.onDestroyed(function () {
  $('#CSAFRemoveModal').off('.CSAFRemoveModal');
});

Template.CSAFRemoveModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  removeTargetName: function () {
    let target = Session.get('CSAFRemove')
    if (target) {
      target = JSON.parse(target)
    }
    return target && target.name
  }
});

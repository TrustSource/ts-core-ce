import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import Projects from '/imports/lib/collections/projects';

Template.projectApprovedStatus.onCreated(function () {
  let hasApproves = new ReactiveVar(false);
  Meteor.callAsync(
    'Approves.CountApprovedProjectApproves',
    Template.currentData().projectId,
    Template.currentData().moduleId
  ).then(function(data) {
    hasApproves.set(data > 0)
  }).catch(function(error) {
    console.error('Approves.CountApprovedProjectApproves failed:', error);
  });
  this.hasApproves = hasApproves;
});

Template.projectApprovedStatus.helpers({
  isUnassigned: function () {
    return this.projectId === Projects.UNASSIGNED
  },
  hasApproves: function () {
    return Template.instance().hasApproves.get();
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {moment} from 'meteor/momentjs:moment';
import Notify from '/imports/api/notify';

Template.legalRequirementsHistoryEntry.helpers({
  requirements: function () {
    const data = Template.currentData();
    return data.requirements
  },
  hasRequirements: function () {
    const data = Template.currentData();
    return data.requirements && (data.requirements.CA || data.requirements.TS)
  },
  getUpdated: function () {
    const data = Template.currentData();
    return data && data.details && data.details.created
  },
  getUpdatedBy: function () {
    const data = Template.currentData();
    return data && data.details && data.details.userName
  }
});

Template.legalRequirementsHistoryEntry.events({
  'click .copy-requirements-settings': function (event) {
    event.preventDefault();
    const data = Template.currentData();
    const details = data.details;
    if (data.moduleId) {
      Meteor.callAsync('Modules.UpdateRequirements', data.moduleId, data.requirements, true).then(() => {
        Session.set('legalHistory', false);
        Notify.success('Legal settings copied from: ' + moment(details.created).format('lll'));
      }).catch((error) => {
        Session.set('legalHistory', false);
        console.log('Update problem: ', error);
      });
    }
    if (data.projectId) {
      Meteor.callAsync('Projects.UpdateRequirements', data.projectId, data.requirements).then(() => {
        Session.set('legalHistory', false);
        Notify.success('Legal settings copied from: ' + moment(details.created).format('lll'));
      }).catch((error) => {
        Session.set('legalHistory', false);
        console.log('Update problem: ', error);
      });
    }
  }
});

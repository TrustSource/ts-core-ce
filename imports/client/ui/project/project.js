import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Projects from '/imports/lib/collections/projects';

Template.project.events({
  'click .panel-body': function () {
    Router.go('projectModules', {projectId: this._id});
  }
});

Template.project.helpers({

  getProjectOptions: function () {
    return {
      projectId: this._id
    }
  },
  getUnassignedState: function () {
    return this.moduleCount > 0 ? 'warnings' : 'ok';
  },
  getStatistics: function () {
    return this.getStatistics()
  },
  isNotUnassigned: function () {
    return this._id !== Projects.UNASSIGNED
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  }
});

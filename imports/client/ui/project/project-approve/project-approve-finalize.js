import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Approves from '/imports/lib/collections/approves';


Template.projectApproveFinalize.helpers({

  approveData: function () {
    return Approves.findOne(Router.current().params.approveId);
  },

  getProjectOptions: function () {
    return {
      projectId: Router.current().params.projectId
    };
  },

  isUnassignedProject: function (project) {
    project = project || this;
    return project && project._id === Projects.UNASSIGNED;
  },

  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },

  getRelease: function () {
    let release = _.sortBy(_.filter(this.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse();
    return release[0]
  },

  getApproveOptions: function () {
    const approve = Approves.findOne(Router.current().params.approveId)
    return {approveId : approve._id}
  }
});

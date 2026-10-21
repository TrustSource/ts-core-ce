import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {moment} from 'meteor/momentjs:moment';
import Approves from '/imports/lib/collections/approves';

function updateAnalysis(reload, approveId) {
  Session.set('currentApprove', approveId);
  if (reload) {
    let query = Router.current().params.query || {};
    query.version = approveId;
    Router.go(Router.current().route.getName(), {
      projectId: Router.current().params.projectId,
      moduleId: Router.current().params.moduleId
    }, {
      query: query
    });
  }
}

Template.projectVersion.onRendered(function () {
  if(Router.current().params && Router.current().params.query && Router.current().params.query.version){
    Session.set('currentApprove', Router.current().params.query.version)
  }else{
    Session.set('currentApprove')
  }
});

Template.projectVersion.events({
  'click .change-version': function (event) {
    event.preventDefault();
    const approveId = $(event.currentTarget).data('value');
    if(approveId){
      updateAnalysis(true, approveId);
    }else{
      Session.set('currentApprove');
      Router.go(Router.current().route.getName(), {
        projectId: Router.current().params.projectId,
        moduleId: Router.current().params.moduleId
      });
    }
  }
});

Template.projectVersion.helpers({
  approvedVersions: function () {
    return Approves.find().fetch()
  },
  isCurrentApprove: function (_id) {
    const currentApprove = Session.get('currentApprove');
    return currentApprove && _id === currentApprove
  },
  currentApprove: function () {
    return Session.get('currentApprove');
  },
  currentVersionLabel: function () {
    const approveId = Session.get('currentApprove');
    if (!approveId) return 'Current state';
    const approve = Approves.findOne(approveId);
    if (approve) {
      let label = moment(approve.approved).format('lll');
      if (approve.name) label += ' - ' + approve.name;
      return label;
    }
    return 'Current state';
  }
});

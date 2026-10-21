import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';


Template.moduleGraphs.onRendered(function () {
  this.autorun(function () {
    Session.set('graphLoading',true);
  });
});

Template.moduleGraphs.helpers({
  isLoading: function () {
    return Session.get('graphLoading');
  },
  currentGraphBreadcrumbs: function () {
    return Session.get('currentGraphBreadcrumbs');
  }
});

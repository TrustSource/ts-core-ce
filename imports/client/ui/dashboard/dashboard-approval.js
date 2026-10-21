import {Template} from 'meteor/templating';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Approves from '/imports/lib/collections/approves';

Template.dashboardApproval.helpers({
  getReleases: function(){
    let approves = Approves.find().fetch();
    let projects = _.groupBy(approves,'projectId');
    projects = _.map(projects, function (approves, projectId) {
      let projectApproves = [];
      let modules = _.groupBy(approves,'moduleId');
      modules = _.map(modules, function (approves, moduleId) {
        if(moduleId && moduleId !== 'undefined'){
          return {
            module: Modules.findOne(moduleId),
            approves
          }
        }else{
          projectApproves = approves
        }
      });
      return {
        project: Projects.findOne(projectId),
        modules: _.filter(modules, function (module) {
          return module
        }),
        approves: projectApproves
      }
    });
    return projects
  },
  getReleasesCount: function(){
    let approves = Approves.find().fetch();
    return approves.length
  },
  sortedReleases: function(element) {
    return _.sortBy(element.approves, function(release) {
      return release.created;
    }).reverse();
  },
  isEmpty: function () {
    return Approves.find().count() === 0;
  }
});

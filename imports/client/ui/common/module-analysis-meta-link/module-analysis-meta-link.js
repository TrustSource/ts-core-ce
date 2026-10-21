import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';
import Projects from '/imports/lib/collections/projects'

Template.moduleAnalysisMetaLink.helpers({
  actionRoute: function () {
    const module = this;
    let route = {
      route: 'moduleDependencies',
      params: {
        projectId: module.projectId || Projects.UNASSIGNED,
        moduleId: module._id
      }
    };
    if(module.analysis && module.analysis._id){
      route.query = {
        analysis: module.analysis._id
      };
    }
    if(module.componentKey){
      if(!route.query){
        route.query = {};
      }
      route.query.filter = module.componentKey
    }
    return route
  },
  getDateFormated: function (date) {
    return moment(date).format('lll')
  }
});

import {Template} from 'meteor/templating';

Template.ciaRequirementsDescription.helpers({
  requirements: function () {
    return this.requirements
  },
  compare: function (a, b) {
    return a === b
  },
  getRouteName: function () {
    return !this.moduleId ? 'projectSettings' : 'moduleSettings'
  },
  getRouteOptions: function () {
    let options = {
      projectId: this.projectId
    };
    if(this.moduleId){
      options.moduleId = this.moduleId
    }
    return options
  }
});
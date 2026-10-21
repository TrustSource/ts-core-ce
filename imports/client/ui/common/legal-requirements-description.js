import {Template} from 'meteor/templating';

Template.legalRequirementsDescription.helpers({
  requirements: function () {
    return this.requirements
  },
  hasRequirements: function () {
    return this.requirements && (this.requirements.CA || this.requirements.TS)
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

import {Template} from 'meteor/templating';

Template.legalRequirementsDescriptionDetails.helpers({
  requirements: function () {
    return this.requirements
  },
  compare: function (a, b) {
    return a === b
  }
});

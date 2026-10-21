import {Template} from 'meteor/templating';
import {moment} from 'meteor/momentjs:moment';
import Projects from '/imports/lib/collections/projects'

Template.projectMetaLink.helpers({
  actionRoute: function () {
    const module = this;
    return {
      route: 'projectModules',
      params: {
        projectId: module._id || Projects.UNASSIGNED
      }
    }
  },
  getDateFormated: function (date) {
    return moment(date).format('lll')
  }
});

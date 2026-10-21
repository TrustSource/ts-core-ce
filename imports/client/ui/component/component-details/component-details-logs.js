import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import ComponentLogs from '/imports/lib/collections/componentLogs';

Template.componentDetailsLogs.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getComponentLogs: function () {
    return ComponentLogs.find({componentKey:this.getKey()}, {sort: {created: -1}}).fetch()
  },
  getDate: function () {
    return this.created
  }
});

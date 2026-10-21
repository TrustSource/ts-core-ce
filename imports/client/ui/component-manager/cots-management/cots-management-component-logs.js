import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import ComponentLogs from '/imports/lib/collections/componentLogs';


Template.cotsManagementComponentsLogs.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getComponentLogs: function () {
    // The route renders before its subscription is ready, and for an unknown id there
    // is no component at all: either way the data context is not a component yet.
    if (!this || typeof this.getKey !== 'function') {
      return [];
    }
    return ComponentLogs.find({componentKey:this.getKey()}, {sort: {created: -1}}).fetch()
  },
  getDate: function () {
    return this.created
  }
});

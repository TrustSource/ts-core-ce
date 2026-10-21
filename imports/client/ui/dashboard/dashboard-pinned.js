import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import Projects from '/imports/lib/collections/projects';

Template.dashboardPinned.onCreated(async function () {
  if(!Session.get('getCompanyTags')){
    try {
      const results = await Meteor.callAsync('getCompanyTags');
      Session.set('getCompanyTags', results);
    } catch (error) {
      console.error(error);
    }
  }
});

Template.dashboardPinned.helpers({
  getPinnedProjects: function(){
    const user = Meteor.user();
    return Projects.findMapped({'relatedUsers.pinnedBy':user._id})
  },
  isEmpty: function () {
    const user = Meteor.user();
    if (!user) return true;
    const pinned = Projects.findMapped({'relatedUsers.pinnedBy': user._id});
    return !pinned || pinned.length === 0;
  }
});

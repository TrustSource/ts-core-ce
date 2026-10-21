import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Notify from '/imports/api/notify';

function postActions(error, item, type, action) {
  const user = Meteor.user();
  if (error) {
    Notify.danger(error.message);
    Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'pinAction');
  } else {
    Meteor.callAsync('logEvent', user, 'User '+user.profile.name+' ('+user.profile.email+') choose to '+action+' ' +type+' '+item.name,
      'pinAction');
  }
}

Template.pinAction.events({
  'click .pin-item'(event) {
    event.preventDefault();
    event.stopPropagation();
    const user = Meteor.user();
    let item = this.item;
    const type = this.type;
    if (!item.relatedUsers){
      item.relatedUsers = {}
    }
    if (!item.relatedUsers.pinnedBy){
      item.relatedUsers.pinnedBy = []
    }
    item.relatedUsers.pinnedBy.push(user._id);
    if (type === 'project'){
      Meteor.callAsync('Projects.UpdatePinnedBy', item._id, item.relatedUsers.pinnedBy)
        .then(() => postActions(null, item, type, 'pin'))
        .catch((error) => postActions(error, item, type, 'pin'));
    }else if (type === 'module'){
      Meteor.callAsync('Modules.UpdatePinnedBy', item._id, item.relatedUsers.pinnedBy)
        .then(() => postActions(null, item, type, 'pin'))
        .catch((error) => postActions(error, item, type, 'pin'));
    }
  },
  'click .unpin-item'(event) {
    event.preventDefault();
    event.stopPropagation();
    const user = Meteor.user();
    let item = this.item;
    const type = this.type;
    const index = item.relatedUsers.pinnedBy.indexOf(user._id);
    if (index > -1) {
      item.relatedUsers.pinnedBy.splice(index, 1);
    }
    if (type === 'project'){
      Meteor.callAsync('Projects.UpdatePinnedBy', item._id, item.relatedUsers.pinnedBy)
        .then(() => postActions(null, item, type, 'unpin'))
        .catch((error) => postActions(error, item, type, 'unpin'));
    }else if (type === 'module'){
      Meteor.callAsync('Modules.UpdatePinnedBy', item._id, item.relatedUsers.pinnedBy)
        .then(() => postActions(null, item, type, 'unpin'))
        .catch((error) => postActions(error, item, type, 'unpin'));
    }
  }
});
Template.pinAction.helpers({
  isPinned: function () {
    const user = Meteor.user();
    if(user && this.item){
      let related = this.item.relatedUsers;
      let pinnedBy = related && related.pinnedBy;
      return pinnedBy ? pinnedBy.indexOf(user._id) > -1 : false
    }
  }
});

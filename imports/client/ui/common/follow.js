import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Notify from '/imports/api/notify';
import {Session} from 'meteor/session';

function postActions(error, item, type, action) {
  const user = Meteor.user();
  if (error) {
    Notify.danger(error.message);
    Meteor.callAsync('logEvent', user, 'Error: '+ error.message, 'followAction').catch(function() {});
  } else {
    Meteor.callAsync('logEvent', user, 'User '+user.profile.name+' ('+user.profile.email+') choose to '+action+' ' +type+' '+item.name,
      'followAction').catch(function() {});
    if(type === 'module'){
      Meteor.setTimeout(()=>{
        Meteor.callAsync('modulesByProject', false, true).then(data => {
          Session.set('modulesByProject', data)
        }).catch(function(error) {
          console.error('modulesByProject failed:', error);
        })
      },300)
    }
  }
}

Template.followAction.events({
  'click .follow-item'(event) {
    event.preventDefault();
    event.stopPropagation();
    const user = Meteor.user();
    let item = this.item;
    const type = this.type;
    if (!item.relatedUsers){
      item.relatedUsers = {}
    }
    if (!item.relatedUsers.followers){
      item.relatedUsers.followers = []
    }
    item.relatedUsers.followers.push(user._id);
    const Collection = type === 'project' ? Projects : Modules;
    Collection.updateAsync(item._id, {$set: {'relatedUsers.followers':item.relatedUsers.followers}})
      .then(function () { postActions(null, item, type, 'follow') })
      .catch(function (error) { postActions(error, item, type, 'follow') });
  },
  'click .unfollow-item'(event) {
    event.preventDefault();
    event.stopPropagation();
    const user = Meteor.user();
    let item = this.item;
    const type = this.type;
    const index = item.relatedUsers.followers.indexOf(user._id);
    if (index > -1) {
      item.relatedUsers.followers.splice(index, 1);
    }
    const Collection = type === 'project' ? Projects : Modules;
    Collection.updateAsync(item._id, {$set: {'relatedUsers.followers':item.relatedUsers.followers}})
      .then(function () { postActions(null, item, type, 'unfollow') })
      .catch(function (error) { postActions(error, item, type, 'unfollow') });
  }
});
Template.followAction.helpers({
  isFollowing: function () {
    const user = Meteor.user();
    if(user && this.item){
      let related = this.item.relatedUsers;
      let followers = related && related.followers;
      return followers ? followers.indexOf(user._id) > -1 : false
    }
  },
  getCounter: function () {
    if(this.item){
      let related = this.item.relatedUsers;
      return  related && related.followers ? related.followers.length : 0
    }
  }
});

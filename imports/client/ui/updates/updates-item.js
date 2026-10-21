import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';


Template.updatesItem.onCreated(function () {
  Meteor.callAsync('Updates.View', this.data._id, null).catch(function(error) {
    console.log(error);
  });
});
Template.updatesItem.helpers({
  isNew: function (){
    return this && this.type === 'new'
  },
  isImprovement: function (){
    return this && this.type === 'improvement'
  },
  isFix: function (){
    return this && this.type === 'fix'
  },
  getId: function (){
    return this && +this.published
  },
  getDate: function (){
    return this && (+this.published || +this.created)
  }
});

import {Template} from 'meteor/templating';

Template.updates.helpers({
  getList: function () {
    return this
  },
  listAvailable: function (){
    return this && this.length
  }
});

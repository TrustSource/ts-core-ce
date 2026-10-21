import {Template} from 'meteor/templating';

Template.leanixLink.helpers({
  leanixApp: function () {
    return this.leanix.split('++')[0];
  },
  leanixType: function () {
    return this.leanix.split('++')[1];
  },
  leanixId: function () {
    return this.leanix.split('++')[2];
  }
});

import {Template} from 'meteor/templating';

Template.crawlerDataNotice.helpers({
  isCheck: function (name) {
    return Template.currentData().check === name;
  }
});

import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.pageHeader.events({

  'click .small-header-action': function (event) {
    event.preventDefault();
    $('.ts-page-header').toggleClass('ts-header-compact');
    $('#ts-breadcrumb').toggleClass('m-t-lg');
    $('.ts-clip-header i').toggleClass('fa-arrow-up').toggleClass('fa-arrow-down');
  }

});

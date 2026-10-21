import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.blankLayout.onRendered(function () {
  $('body').addClass('blank');

});

Template.blankLayout.onDestroyed(function () {
  $('body').removeClass('blank');
});

import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.notFound.onRendered(function () {
  // For any reason the router hook
  //          Router.onAfterAction(function() {
  //              setTimeout(function() {
  //                $('.splash').css('display', 'none')
  //              })
  //          });
  // does not work for the "notFoundTemplate". This is a workaround for this problem
  $('#splash').css('display', 'none');
});

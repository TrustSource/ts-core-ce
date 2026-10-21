import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';

Template.reportsListIssue.onRendered(function () {
  $('.panel-body').tooltip({
    selector: '[data-toggle=tooltip]'
  });
});

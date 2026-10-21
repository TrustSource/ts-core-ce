import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {Spacebars} from 'meteor/spacebars';
import {metaChip} from '/imports/lib/html/tableCells';

Template.scanList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  $('.panel-body').tooltip({
    selector: '[data-toggle=tooltip]'
  });
});

Template.scanList.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
});

Template.scanList.helpers({
  method: function () {
    return 'Scans.Find'
  },
  filters: function () {
    return ['module'];
  },
  sortings: function () {
    return ['submitted', 'project', 'module', 'user', 'branch', 'tag', 'dependencyCount'];
  },
  options: function () {
    return {
      sort: {submitted: -1},
      size: 15
    };
  },
  fields: function () {
    return [
      {
        fieldId: 'submitted',
        key: 'submitted',
        label: 'When',
        cellClass: 'col-date',
        sortable: false,
        tmpl: Template.reactiveTableDateCell
      },
      {
        fieldId: 'project',
        key: 'project',
        label: 'Project - Module',
        sortable: false,
        fn: function (value, object) { return object.project + ' - ' + object.module; }
      },
      {
        fieldId: 'user',
        key: 'user',
        label: 'Upload by',
        sortable: false,
        fn: function (value, object) { return object.user; }
      },
      {
        fieldId: 'dependencyCount',
        key: 'dependencyCount',
        label: 'Dependencies',
        sortable: false,
        fn: function (value, object) {
          return new Spacebars.SafeString('<span class="badge" sort=' + (object.dependencyCount || 0) + '>' +
            (object.dependencyCount || 0) + '</span>');
        }
      },
      {
        fieldId: 'tag',
        key: 'tag',
        label: 'Meta',
        sortable: false,
        fn: function (value, object) {
          // Branch, tag and link names are free text from the scan API: escaped
          // by metaChip, since this cell returns markup.
          let list = [];
          if(object.branch){
            list.push(metaChip('fa-code-fork', 'Branch', object.branch))
          }
          if(object.tag){
            list.push(metaChip('fa-tag', 'Tag', object.tag))
          }
          if(object.binaryLinks){
            _.each(object.binaryLinks, function (link) {
              list.push(metaChip('fa-link', 'Binary link', link && link.name))
            })
          }
          return new Spacebars.SafeString(list.join('<span class="inner-r-10"></span>'));
        }
      }
    ]
  }
});

Template.scanList.events({
  'click .reactive-table tbody tr': function (event) {
    if ($(event.target).closest('a, button').length) return;
    if (this._id) {
      Router.go('scanDetail', {_id: this._id});
    }
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

Template.scanDetailBinary.onRendered(function () {
  $('#addBinaryLinkForm').validate({
    rules: {
      binaryName: {
        required: true
      },
      binaryComment: {
        required: false
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const user = Meteor.user();
      let name = $(form).find('[name=binaryName]').val();
      let comment = $(form).find('[name=binaryComment]').val();
      Meteor.callAsync('Scans.BinaryLinkAdd', Router.current().params._id, {name,comment}).then(function() {
        const message = 'New binary link ' + name + ' created';
        Notify.success(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkCreated');
      }).catch(function(error) {
        const message = 'Internal Error: ' + (error.reason || 'could not create link');
        Notify.danger(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkCreated');
      });
    }
  });

  $('#binaryLinks').off('.scanDetailBinary')
    .on('show.bs.modal.scanDetailBinary', function (event) {
      $('#addBinaryLinkForm').validate().resetForm();
      $(event.target).find('[name=binaryName]').val('').removeClass('error');
      $(event.target).find('[name=binaryComment]').val('').removeClass('error');
    });
});

Template.scanDetailBinary.onDestroyed(function () {
  $('#binaryLinks').off('.scanDetailBinary');
});

Template.scanDetailBinary.events({
  'submit #addBinaryLinkForm': function (event) {
    event.preventDefault();
  }
});

Template.scanDetailBinary.helpers({
  reactiveTableSettings: function () {
    return {
      collection: this.binaryLinks || [],
      rowsPerPage: 15,
      showFilter: true,
      noDataTmpl: Template.reactiveTableNoData,
      fields: [
        {
          fieldId: 'created',
          key: 'created',
          label: 'Created',
          sortOrder: 0,
          sortDirection: 'descending',
          cellClass: 'col-date',
          tmpl: Template.reactiveTableDateCell
        },
        {
          fieldId: 'name',
          key: 'name',
          label: 'Link',
          cellClass: 'col-binary-link',
          tmpl: Template.reactiveTableBinaryLinkCell
        },
        {
          fieldId: 'comment',
          key: 'comment',
          label: 'Comment',
          fn: function (value, object) { return object.comment; }
        },
        {
          fieldId: 'userName',
          key: 'userName',
          label: 'Creator',
          cellClass: 'col-sender',
          fn: function (value, object) { return object.userName; }
        },
        {
          fieldId: 'actions',
          key: 'actions',
          label: '',
          sortable: false,
          tmpl: Template.reactiveTableScanBinaryActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableScanBinaryActions.events({
  'click .remove-link': function (event) {
    event.preventDefault();
    const {name, created, locked} = this;
    Meteor.callAsync(
      'Scans.BinaryLinkRemove',
      Router.current().params._id,
      {name, created, locked}
    ).then(function() {
      const user = Meteor.user();
      const message = 'Binary  link '+name+' removed from scan';
      Notify.success(message);
      Meteor.callAsync('logEvent', user, message, 'binaryLinkRemoved');
    }).catch(function(error) {
      const user = Meteor.user();
      const message = 'Internal Error: ' + (error.reason || 'could not remove link');
      Notify.danger(message);
      Meteor.callAsync('logEvent', user, message, 'binaryLinkRemoved');
    })
  }
});

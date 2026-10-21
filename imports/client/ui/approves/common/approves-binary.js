/* global swal:false */
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';

function resetForm() {
  let form = $('#addBinaryLinkForm');
  if(form.length){
    form.validate().resetForm();
  }
  form.find('[name=binaryName]').val('').removeClass('error');
  form.find('[name=binaryComment]').val('').removeClass('error');
}

Template.approvesBinary.onRendered(function () {
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
      Meteor.callAsync(
        'Approves.BinaryLinkAdd',
        Router.current().params.approveId,
        {name,comment}
      ).then(function() {
        const message = 'New binary link ' + name + ' created';
        Notify.success(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkCreated');
        resetForm();
      }).catch(function(error) {
        const message = 'Internal Error: ' + (error.reason || 'could not create link');
        Notify.danger(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkCreated');
      });
    }
  });

  $('#binaryLinks').off('.approvesBinary')
    .on('show.bs.modal.approvesBinary', function () { resetForm(); });
});

Template.approvesBinary.onDestroyed(function () {
  $('#binaryLinks').off('.approvesBinary');
});

Template.approvesBinary.events({
  'submit #addBinaryLinkForm': function (event) {
    event.preventDefault();
  }
});

Template.approvesBinary.helpers({
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
          tmpl: Template.reactiveTableApprovesBinaryActions,
          cellClass: 'col-actions'
        }
      ]
    };
  }
});

Template.reactiveTableApprovesBinaryActions.events({
  'click .remove-link': function (event) {
    event.preventDefault();
    const {name, created, locked} = this;
    // Removal is immediate and irreversible - a misclick used to drop a published artifact
    // reference with no undo. Confirm first, matching the approve/reject actions.
    swal({
      title: 'Are you sure you want to remove this binary link?',
      text: name + '\nYou will not be able to revert this!',
      type: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, remove it!'
    }, function () {
      Meteor.callAsync(
        'Approves.BinaryLinkRemove',
        Router.current().params.approveId,
        {name, created, locked}
      ).then(function() {
        const user = Meteor.user();
        const message = 'Binary  link '+name+' removed from approval';
        Notify.success(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkRemoved');
      }).catch(function(error) {
        const user = Meteor.user();
        const message = 'Internal Error: ' + (error.reason || 'could not remove link');
        Notify.danger(message);
        Meteor.callAsync('logEvent', user, message, 'binaryLinkRemoved');
      })
    });
  }
});

Template.reactiveTableApprovesBinaryActions.helpers({
  isApproved: function () {
    const params = Template.parentData(5);
    return params.approved
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Projects from '/imports/lib/collections/projects';

Template.approvesCreate.onRendered(function () {
  const $modal = this.$('#createApproveModal');
  let clickedAction = 'approve';

  $modal.find('[type=submit]').on('click', function () {
    clickedAction = $(this).val();
  });

  $modal.find('#createApproveForm').validate({
    rules: {
      approveProject: {
        required: true
      }
    },
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function () {
      const projectId = $modal.find('[name=approveProject]').val();
      const action = clickedAction;
      $modal.one('hidden.bs.modal', function () {
        if (action === 'draft') {
          Router.go('projectApprove', {projectId: projectId}, {query: {draft: true}});
        } else {
          Router.go('projectApprove', {projectId: projectId});
        }
      });
      $modal.modal('hide');
    }
  });

  $modal.off('.approvesCreate')
    .on('show.bs.modal.approvesCreate', function (event) {
      $(event.target).find('form').validate().resetForm();
      $(event.target).find('[name=approveProject]').val('').removeClass('error');
      $('select.select2').select2({
        placeholder: 'Please select a project',
        width: '100%',
        dropdownParent: $(event.target)
      });
    });
});

Template.approvesCreate.onDestroyed(function () {
  $('#createApproveModal').off('.approvesCreate');
});

Template.approvesCreate.events({
  'submit .form': function (event) {
    event.preventDefault();
  }
});

Template.approvesCreate.helpers({
  projectList: function () {
    const user = Meteor.user();
    if (!user || !user.profile) return [];
    return Projects.find({
      $and: [{
        companyId: user.profile.companyId
      }, {
        $or: [
          {'relatedUsers': {$exists: false}},
          {'relatedUsers.defaultProjectManager': user._id}
        ]
      }]
    }).fetch();
  }
});

import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import Notify from '/imports/api/notify';
import Tags from '/imports/lib/collections/tags';

function resetForm() {
  let form = $('#addTagForm');
  if(form.length){
    form.validate().resetForm();
  }
  form.find('[name=tagName]').val('').removeClass('error');
  form.find('[name=tagDescription]').val('').removeClass('error');
}

Template.companyTagsCreate.onRendered(function () {
  $.validator.addMethod('regex', function(value, element, regexpr) {
    return regexpr.test(value);
  }, 'Your text does not match requirements');

  $('#addTagForm').validate({
    rules: {
      tagName: {
        required: true,
        minlength: 2,
        maxlength: 50,
        regex: /^[a-z0-9:-]+$/
      },
      tagDescription: {
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
      let tagName = $(form).find('[name=tagName]').val();
      let tagDescription = $(form).find('[name=tagDescription]').val();
      const tag = {
        name: tagName,
        description: tagDescription
      };
      if (Tags.findOne({name:tagName, deleted:{$exists: false}})) {
        Notify.danger('Error: Tag with same name already exists');
      } else {
        Meteor.callAsync('Tags.Create', tag).then(function() {
          const message = 'New tag ' + tagName + ' created';
          Notify.success(message);
          Meteor.setTimeout(function () {
            $('#createTag').modal('hide');
          }, 300);
        }).catch(function(error) {
          const message = 'Internal Error: ' + (error.reason || 'could not create tag');
          Notify.danger(message);
        });
      }
    }
  });

  $('#createTag').off('.companyTagsCreate')
    .on('show.bs.modal.companyTagsCreate', function () { resetForm(); })
    .on('hidden.bs.modal.companyTagsCreate', function () { resetForm(); });
});

Template.companyTagsCreate.onDestroyed(function () {
  $('#createTag').off('.companyTagsCreate');
});

Template.companyTagsCreate.events({
  'submit #addTagForm': function (event) {
    event.preventDefault();
  }
});

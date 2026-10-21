import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';

const FORM = '#productDocumentsForm'
const MODAL = '#productDocumentsModal'
const LOADING = 'loadingInProgress'

Template.productDocumentsModal.onRendered(function () {
  $(FORM).validate({
    rules: {
      file: {
        required: true
      },
      documentType: {
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
    submitHandler: function (form) {
      const self = Blaze.getData($(FORM)[0]);
      Session.set(LOADING, true)
      const documentType = $(form).find('[name=documentType]').val();
      const file = $(form).find('[name=file]')[0].files[0];
      const validExtensions = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','odt','odp','ods'];
      const fileName = file.name;
      const fileExtension = file.name.slice(file.name.lastIndexOf('.')+1).toLowerCase();
      if (!validExtensions.includes(fileExtension)) {
        Notify.danger('Invalid file type. Please upload a one of the allowed file formats.');
        Session.set(LOADING)
        return;
      }
       
      const reader = new FileReader();
      reader.onload = function (event) {
        const arrayBuffer = event.target.result;
         
        const uint8 = new Uint8Array(arrayBuffer);
        Meteor.callAsync('Products.DocumentUpload', {
          file:{
            documentType,
            fileName: fileName,
            fileExtension: fileExtension,
            mimeType: file.type,
            data: Array.from(uint8)
          }, product: {
            _id: self._id
          }
        }).then(data => {
          if(data){
            Notify.success('Document updated');
            $(MODAL).modal('hide');
          }
        }).catch(error => {
          Notify.danger(error.message);
        }).finally(() => {
          Session.set(LOADING)
        });
      };
      reader.readAsArrayBuffer(file);
    }
  });

  $(MODAL).off('.productDocumentsModal')
    .on('show.bs.modal.productDocumentsModal', function (event) {
      $(FORM).validate().resetForm();
      $(event.target).find('[name=documentType]').val('userManual').trigger('change').removeClass('error');
      $(event.target).find('[name=filename]').val('');
      $(event.target).find('[name=file]').val('').removeClass('error');
    });
});

Template.productDocumentsModal.onDestroyed(function () {
  $(MODAL).off('.productDocumentsModal');
});

Template.productDocumentsModal.events({
  'submit #productDocumentsForm': function (event) {
    event.preventDefault();
  }
});

$(document).on('change', '#productDocumentsModal input[name=file]', function (event) {
  $(event.target).closest('.input-group-file').find('input[name=filename]').val(event.target.files[0] ? event.target.files[0].name : '');
});

Template.productDocumentsModal.helpers({
  documentTypes: function () {
    return [
      {
        value: 'userManual',
        label: 'User Manual'
      },
      {
        value: 'secureSetup',
        label: 'Secure Setup'
      },
      {
        value: 'productDescription',
        label: 'Product Description'
      },
      {
        value: 'sbom',
        label: 'SBOM file'
      },
      {
        value: 'cedoc',
        label: 'CE mark declaration'
      }
    ]
  },
  loading: function () {
    return Session.get(LOADING);
  }
});

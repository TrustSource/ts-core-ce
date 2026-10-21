import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var'
import Products from '/imports/lib/collections/products';
import Notify from '/imports/api/notify';

const FORM = '#productImportForm'
const MODAL = '#productImportModal'
const LOADING = 'loadingInProgress'

Template.productImportModal.onCreated(function () {
  $('.select2').select2({
    allowClear: true,
    width: '100%'
  });
  this.currentUpload = new ReactiveVar(false);
});

Template.productImportModal.onRendered(function () {
  let modal = $(MODAL);

  modal.on('show.bs.modal', function () {
    $(FORM).validate().resetForm();
    let identifier = Router.current().params && Router.current().params.query && Router.current().params.query.identifier;
    modal.find('[name=parentId]').val(identifier || '').trigger('change').removeClass('error');
    modal.find('[name=filename]').val('');
    modal.find('[name=file]').val('').removeClass('error');
    modal.find('[name=draft]').prop('checked', false);
  });

  modal.find('input[name=file]').on('change', function () {
    modal.find('input[name=filename]').val(this.files[0] ? this.files[0].name : '');
  });

  $(FORM).validate({
    rules: {
      file: {
        required: true
      },
      parentId: {
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
      Session.set(LOADING, true)
      const parentId = $(form).find('[name=parentId]').val();
      const draft = $(form).find('[name=draft]').is(':checked');
      const file = $(form).find('[name=file]')[0].files[0];
      const validExtensions = ['.json'];
      const fileName = file.name;
      const fileExtension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!validExtensions.includes(fileExtension)) {
        Notify.danger('Invalid file type. Please upload a .json file.');
        Session.set(LOADING)
        return;
      }
       
      const reader = new FileReader();
      reader.onload = function(event) {
        let file = event.target.result
        Meteor.callAsync('Products.Import', {draft, fileName, file, parentId}).then(function(count) {
          Notify.success(count ? `${count} products added` : 'Products added');
          $(MODAL).modal('hide');
        }).catch(function(error) {
          Notify.danger(error.message);
        }).finally(function() {
          Session.set(LOADING);
        })
      };
      reader.readAsText(file);
    }
  });
});

Template.productImportModal.events({
  'submit #productImportForm': function (event) {
    event.preventDefault();
  }
});

Template.productImportModal.helpers({
  currentUpload() {
    return Template.instance().currentUpload.get();
  },
  productList: function () {
    return Products.find({retired: {$in: [null]}}, {sort: {name: 1}});
  },
  isSelected: function (item) {
    return item === Router.current().params.query.identifier;
  },
  loading: function () {
    return Session.get(LOADING);
  }
});

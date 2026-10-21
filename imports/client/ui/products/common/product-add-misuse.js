import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Notify from '/imports/api/notify';

const FORM = '#productAddMisuseForm'
const MODAL = '#productAddMisuse'
const LOADING = 'loadingInProgress'

Template.productAddMisuse.onRendered(function () {
  $(FORM).validate({
    rules: {
      name: {
        required: true
      },
      description: {
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
      const name = $(form).find('[name=name]').val();
      const description = $(form).find('[name=description]').val();
      if (!name) {
        Notify.warn('Required params are missing');
      } else {
        Session.set(LOADING, true)
        const item = {
          misuse: {
            name,
            description
          },
          product: {
            identifier: Router.current().params.query.identifier
          }
        }
        Meteor.callAsync('Products.MisuseCreate', item).then(data => {
          if(data){
            Notify.success('Misuse case added');
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        });
      }
    }
  });

  $(MODAL).off('.productAddMisuse')
    .on('show.bs.modal.productAddMisuse', function (event) {
      $(FORM).validate().resetForm();
      $(event.target).find('[name=name]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=description]').val('').trigger('change').removeClass('error');
    });
});

Template.productAddMisuse.onDestroyed(function () {
  $(MODAL).off('.productAddMisuse');
});

Template.productAddMisuse.events({
  'submit #productAddMisuseForm': function (event) {
    event.preventDefault();
  }
});

Template.productAddMisuse.helpers({
  loading: function () {
    return Session.get(LOADING);
  }
});

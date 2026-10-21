import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const FORM = '#productAddSupportForm'
const MODAL = '#productAddSupport'
const LOADING = 'loadingInProgress'

Template.productAddSupport.onRendered(function () {
  $(FORM).validate({
    rules: {
      name: {
        required: true
      },
      description: {
        required: false
      },
      endDate: {
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
      const endDate = $(form).find('[name=endDate]').val();
      const name = $(form).find('[name=name]').val();
      const description = $(form).find('[name=description]').val();
      if (!name) {
        Notify.warn('Required params are missing');
      } else {
        Session.set(LOADING, true)
        const item = {
          support: {
            name,
            description,
            endDate: endDate ? new Date(endDate) : null
          },
          product: {
            identifier: Router.current().params.query.identifier
          }
        }
        Meteor.callAsync('Products.SupportCreate', item).then(data => {
          if(data){
            Notify.success('Support contract added');
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        });
      }
    }
  });

  $(MODAL).off('.productAddSupport')
    .on('show.bs.modal.productAddSupport', function (event) {
      $(FORM).validate().resetForm();
      $(event.target).find('[name=name]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=description]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=endDate]').val('').trigger('change').removeClass('error');
    });
});

Template.productAddSupport.onDestroyed(function () {
  $(MODAL).off('.productAddSupport');
});

Template.productAddSupport.events({
  'submit #productAddSupportForm': function (event) {
    event.preventDefault();
  }
});

Template.productAddSupport.helpers({
  loading: function () {
    return Session.get(LOADING);
  }
});

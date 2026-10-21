import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import Products from '/imports/lib/collections/products';

const FORM = '#productAddForm'
const MODAL = '#productAddModal'
const LOADING = 'loadingInProgress'

Template.productAddModal.onRendered(function () {
  $('.select2').select2({
    allowClear: true,
    width: '100%'
  });
  $(FORM).validate({
    rules: {
      parentId: {
        required: false
      },
      type: {
        required: true
      },
      identifier: {
        required: true
      },
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
      const parentId = $(form).find('[name=parentId]').val();
      const type = $(form).find('[name=type]').val();
      const identifier = $(form).find('[name=identifier]').val();
      const name = $(form).find('[name=name]').val();
      const description = $(form).find('[name=description]').val();
      const draft = $(form).find('[name=draft]').is(':checked');
      if (Products.findOne({identifier})) {
        Notify.danger(`Product with same identifier already exists: ${identifier}`);
      } else if (!name || !type || !identifier) {
        Notify.warn('Required params are missing');
      } else {
        Session.set(LOADING, true)
        const item = {
          draft,
          type,
          identifier,
          name,
          description,
          parentId: parentId ? parentId : null
        }
        Meteor.callAsync('Products.Create', item).then(data => {
          if(data){
            Notify.success('Product added');
            let query = Router.current().params.query || {};
            query.identifier = identifier;
            Router.go(Router.current().route.getName(), {}, {
              query: query
            });
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        });
      }
    }
  });

  $(MODAL).off('.productAddModal')
    .on('show.bs.modal.productAddModal', function (event) {
      $(FORM).validate().resetForm();
      const identifier = Router.current().params && Router.current().params.query && Router.current().params.query.identifier
      $(event.target).find('[name=parentId]').val(identifier || '').trigger('change').removeClass('error');
      $(event.target).find('[name=type]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=identifier]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=name]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=description]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=draft]').prop('checked', false);
    });
});

Template.productAddModal.onDestroyed(function () {
  $(MODAL).off('.productAddModal');
});

Template.productAddModal.events({
  'submit #productAddForm': function (event) {
    event.preventDefault();
  }
});

Template.productAddModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  productList: function () {
    return Products.find({retired: {$in: [null]}}, {sort: {name: 1}});
  },
  isSelected: function (item) {
    return item === Router.current().params.query.identifier;
  }
});

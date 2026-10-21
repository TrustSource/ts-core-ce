/* global document:false, swal:false */
import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';
import Products from '/imports/lib/collections/products';
import {escapeHtml} from '/imports/lib/html/tableCells';

const FORM = '#productEditForm'
const LOADING = 'loadingInProgress'

Template.productEditInformation.onRendered(function () {
  $(FORM).validate({
    rules: {
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
      },
      features: {
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
      const self = Blaze.getData($(FORM)[0]);
      const type = $(form).find('[name=type]').val();
      const identifier = $(form).find('[name=identifier]').val();
      const name = $(form).find('[name=name]').val();
      const description = $(form).find('[name=description]').val();
      const features = $(form).find('[name=features]').val();
      const possibleDuplicate = Products.findOne({identifier});
      if (possibleDuplicate && possibleDuplicate._id !== self._id) {
        Notify.danger('Error: product with same identifier already exists');
      } else if (!name || !type || !identifier) {
        Notify.warn('Required params are missing');
      } else {
        Session.set(LOADING, true)
        const modifier = {
          type,
          identifier,
          name,
          description,
          features
        }
        Meteor.callAsync('Products.Update', {$set: modifier}, self._id).then(data => {
          if(data){
            Notify.success('Product updated');
          }
          let query = Router.current().params.query || {};
          query.identifier = identifier;
          Router.go(Router.current().route.getName(), {}, {
            query: query
          });
          Session.set(LOADING)
        });
      }
    }
  });
});

Template.productEditInformation.events({
  'submit #productEditForm': function (event) {
    event.preventDefault();
  },
  'click .retire_product': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to retire product ' + escapeHtml(self.name) + '? <br>' +
        '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, retire it!'
    }, function (reason) {
      if(reason === false) return false;
      reason = document.getElementById('confirmationText').value;
      if(reason){
        const comment = (reason?reason:'NO REASON PROVIDED');
        Meteor.callAsync('Products.Remove', self._id, comment).then(function() {
          Meteor.callAsync('logEvent', currUser, 'Retired: ' + self.name + ' / Reason: ' + comment, 'productRemoved');
        }).catch(function(error) {
          Notify.danger(error.message);
          Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'productRemoved');
        });
      }else{
        Notify.warn('You are not allowed to remove without reason!');
      }
    });
  },
  'click .un_retire_product': function (event) {
    event.preventDefault();
    const currUser = Meteor.user();
    const self = this;
    swal({
      title: 'Are you sure you want to revert retire product ' + escapeHtml(self.name) + '? <br>' +
        '<textarea id=\'confirmationText\' class="form-control inner-t-5" rows="6"></textarea>',
      html: true,
      showCancelButton: true,
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Yes, revert action!'
    }, function (reason) {
      if(reason === false) return false;
      reason = document.getElementById('confirmationText').value;
      if(reason){
        const comment = (reason?reason:'NO REASON PROVIDED');
        Meteor.callAsync('Products.RemoveRevert', self._id, comment).then(function() {
          Meteor.callAsync('logEvent', currUser, 'Revert: ' + self.name + ' / Reason: ' + comment, 'productRemoved');
        }).catch(function(error) {
          Notify.danger(error.message);
          Meteor.callAsync('logEvent', currUser, 'Error: ' + error.message, 'productRemoved');
        });
      }else{
        Notify.warn('You are not allowed to revert without reason!');
      }
    });
  }
});

Template.productEditInformation.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isSelected: function (item, value) {
    return item === value;
  }
});

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';

const FORM = '#productEditClassificationForm'
const LOADING = 'loadingInProgress'

Template.productEditClassification.onRendered(function () {
  $(FORM).validate({
    rules: {
      classification: {
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
      const classification = $(form).find('[name=classification]').val();
      Session.set(LOADING, true)
      const modifier = {
        classification
      }
      Meteor.callAsync('Products.Update', {$set: modifier}, self._id).then(data => {
        if(data){
          Notify.success('Product updated');
        }
        Session.set(LOADING)
      });
    }
  });
});

Template.productEditClassification.events({
  'submit #productEditClassificationForm': function (event) {
    event.preventDefault();
  }
});

Template.productEditClassification.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isSelected: function (item, value) {
    return item === value;
  }
});

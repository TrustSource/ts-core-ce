import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';

const FORM = '#productEditContactsForm'
const LOADING = 'loadingInProgress'

Template.productEditContacts.onRendered(function () {
  $(FORM).validate({
    rules: {
      registeredTradeName: {
        required: false
      },
      manufacturerName: {
        required: false
      },
      manufacturerAddress: {
        required: false
      },
      manufacturerWebsite: {
        required: false
      },
      productSecurityContact: {
        required: false
      },
      productSecurityWeblink: {
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
      const registeredTradeName = $(form).find('[name=registeredTradeName]').val();
      const manufacturerName = $(form).find('[name=manufacturerName]').val();
      const manufacturerAddress = $(form).find('[name=manufacturerAddress]').val();
      const manufacturerWebsite = $(form).find('[name=manufacturerWebsite]').val();
      const productSecurityContact = $(form).find('[name=productSecurityContact]').val();
      const productSecurityWeblink = $(form).find('[name=productSecurityWeblink]').val();
      Session.set(LOADING, true)
      const modifier = {
        contacts: {
          registeredTradeName,
          manufacturerName,
          manufacturerAddress,
          manufacturerWebsite,
          productSecurityContact,
          productSecurityWeblink
        }
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

Template.productEditContacts.events({
  'submit #productEditContactsForm': function (event) {
    event.preventDefault();
  }
});

Template.productEditContacts.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isSelected: function (item, value) {
    return item === value;
  }
});

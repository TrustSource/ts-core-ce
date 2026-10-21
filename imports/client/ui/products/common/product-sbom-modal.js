import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {Blaze} from 'meteor/blaze';
import Notify from '/imports/api/notify';

const FORM = '#productSbomForm'
const MODAL = '#productSbomModal'
const LOADING = 'loadingInProgress'

Template.productSbomModal.onRendered(function () {
  $(FORM).validate({
    rules: {},
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function () {
      const self = Blaze.getData($(FORM)[0]);
      Session.set(LOADING, true)
      Meteor.callAsync('Products.SBOMGenerate', {
        product: {
          _id: self._id
        }
      }).then(data => {
        if(data){
          Notify.success('SBOM generated and uploaded into documents');
          $(MODAL).modal('hide');
        }
      }).catch(error => {
        Notify.danger(error.message);
      }).finally(() => {
        Session.set(LOADING)
      });
    }
  });

  $(MODAL).off('.productSbomModal')
    .on('show.bs.modal.productSbomModal', function () { $(FORM).validate().resetForm(); });
});

Template.productSbomModal.onDestroyed(function () {
  $(MODAL).off('.productSbomModal');
});

Template.productSbomModal.events({
  'submit #productSbomForm': function (event) {
    event.preventDefault();
  }
});

Template.productSbomModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  }
});

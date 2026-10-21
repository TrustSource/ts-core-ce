import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

const FORM = '#CapabilitiesAddForm'
const MODAL = '#CapabilitiesAddModal'
const LOADING = 'loadingInProgress'

Template.CapabilitiesAddModal.onRendered(function () {
  const template = Template.instance();
  $(FORM).validate({
    rules: {
      name: {
        required: true
      },
      version: {
        required: false
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
      Session.set(LOADING, true)
      const name = $(form).find('[name=name]').val();
      const version = $(form).find('[name=version]').val();
      const description = $(form).find('[name=description]').val();
      if (!name) {
        Notify.warn('Name is required');
      } else {
        const self = template.data;
        let allData = Session.get('getCapabilitiesList');
        const item = {
          created: new Date(),
          userName: Utils.username(),
          name,
          version,
          description
        }
        if (self.id === 'moduleCapabilitiesSettings') {
          item.moduleId = self.docId;
        }
        if (!allData) {
          allData = []
        }
        allData.push(item)
        Meteor.callAsync('Capabilities.Create', item).then(data => {
          if(data){
            item._id = data
            Session.set('getCapabilitiesList', allData);
            Notify.success('Capability added');
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || 'Could not create capability');
          Session.set(LOADING);
        });
      }
    }
  });

  $(MODAL).off('.CapabilitiesAddModal')
    .on('show.bs.modal.CapabilitiesAddModal', function (event) {
      $(FORM).validate().resetForm();
      $(event.target).find('[name=name]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=version]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=description]').val('').trigger('change').removeClass('error');
    });
});

Template.CapabilitiesAddModal.onDestroyed(function () {
  $(MODAL).off('.CapabilitiesAddModal');
});

Template.CapabilitiesAddModal.events({
  'submit #CapabilitiesAddForm': function (event) {
    event.preventDefault();
  }
});

Template.CapabilitiesAddModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  }
});

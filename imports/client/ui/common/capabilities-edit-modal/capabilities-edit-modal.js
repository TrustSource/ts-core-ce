import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

const FORM = '#CapabilitiesEditForm'
const MODAL = '#CapabilitiesEditModal'
const LOADING = 'loadingInProgress'

Template.CapabilitiesEditModal.onRendered(function () {
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
        const item = self.data
        const modifier = {
          $set:{
            name,
            version,
            description
          }
        }
        if (!allData) {
          allData = []
        }
        allData = allData.map(itm=>{
          if(itm._id === item._id) {
            itm = item
            itm.name = name;
            itm.version = version;
            itm.description = description;
            itm.edited = new Date();
            itm.editedBy = Utils.username();
          }
          return itm;
        })
        Meteor.callAsync('Capabilities.Update', modifier, item._id, null).then(data => {
          if(data){
            Notify.success('Capability updated');
            Session.set('getCapabilitiesList', allData);
          }
          Session.set(LOADING)
          // $(MODAL).modal('hide');
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || 'Could not update capability');
          Session.set(LOADING);
        });
      }
    }
  });
  this.autorun(function () {
  });

  $(MODAL).off('.CapabilitiesEditModal')
    .on('hide.bs.modal.CapabilitiesEditModal', function () {
      $(FORM).validate().resetForm();
      Meteor.setTimeout(function () {
        Session.set('editCapabilitiesDetails')
      },300)
    });
});

Template.CapabilitiesEditModal.onDestroyed(function () {
  $(MODAL).off('.CapabilitiesEditModal');
});

Template.CapabilitiesEditModal.events({
  'submit #CapabilitiesEditForm': function (event) {
    event.preventDefault();
  }
});

Template.CapabilitiesEditModal.helpers({
  isChecked: function (item) {
    return this && this[item]
  },
  isSelected: function (item, value) {
    const template = Template.instance();
    return template && template.data && template.data.data && (template.data.data[item] === value);
  },
  isFormDisabled: function () {
    const template = Template.instance();
    const id = template && template.data && template.data.id;
    const data = template && template.data && template.data.data;
    const disabled = (id === 'moduleCmpRisksSettings' && !data.moduleId)
    return disabled ? 'disabled' : false
  },
  loading: function () {
    return Session.get(LOADING);
  }
});

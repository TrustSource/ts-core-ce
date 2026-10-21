import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const FORM = '#AiModelsSettingsAddForm'
const MODAL = '#AiModelsSettingsAddModal'
const LOADING = 'aiLoadingInProgress'
const EDIT_ITEM = 'aiEditItem'

function setFieldVal(target, name, value) {
  const el = target.find('[name=' + name + ']');
  if (!el.length) return;
  el.val(value === undefined || value === null ? '' : value);
}

function resetForm(target) {
  ['aiName', 'aiVersion', 'aiProvider', 'aiTask', 'aiModelFamily', 'aiArchitecture',
    'aiPurl', 'aiComment'].forEach((name) => setFieldVal(target, name, ''));
}

function populateForm(target, item) {
  setFieldVal(target, 'aiName', item.name);
  setFieldVal(target, 'aiVersion', item.version);
  setFieldVal(target, 'aiProvider', item.provider);
  setFieldVal(target, 'aiTask', item.task);
  setFieldVal(target, 'aiModelFamily', item.modelFamily);
  setFieldVal(target, 'aiArchitecture', item.architecture);
  setFieldVal(target, 'aiPurl', item.purl);
  setFieldVal(target, 'aiComment', item.comment);
}

Template.AiModelsSettingsAddModal.onRendered(function () {
  const template = Template.instance();
  $(FORM).validate({
    rules: {
      aiName: {required: true}
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
      const name = $(form).find('[name=aiName]').val();
      if (!name) {
        Notify.warn('Name is required');
        Session.set(LOADING);
        return;
      }
      const payload = {
        name,
        version: $(form).find('[name=aiVersion]').val(),
        provider: $(form).find('[name=aiProvider]').val(),
        task: $(form).find('[name=aiTask]').val(),
        modelFamily: $(form).find('[name=aiModelFamily]').val(),
        architecture: $(form).find('[name=aiArchitecture]').val(),
        purl: $(form).find('[name=aiPurl]').val(),
        comment: $(form).find('[name=aiComment]').val()
      };
      const self = template.data;
      const editItem = Session.get(EDIT_ITEM);
      let allData = Session.get('getAiModelsSettingsList') || [];

      if (editItem && editItem._id) {
        const $set = Object.assign({}, payload);
        Meteor.callAsync('AiProperties.Update', {$set}, editItem._id).then(() => {
          const updated = allData.map((row) =>
            row._id === editItem._id ? Object.assign({}, row, $set) : row);
          Session.set('getAiModelsSettingsList', updated);
          Notify.success('AI artifact updated');
          Session.set(LOADING);
          $(MODAL).modal('hide');
        }).catch(function (error) {
          Notify.danger(error.reason || error.message || 'Could not update AI artifact');
          Session.set(LOADING);
        });
        return;
      }

      const item = Object.assign({created: new Date()}, payload)
      if (self.id === 'moduleCmpAiModelsSettings') {
        item.moduleId = self.docId;
      } else if (self.id === 'projCmpAiModelsSettings') {
        item.projectId = self.docId;
      }
      allData.push(item)
      Meteor.callAsync('AiProperties.Create', item).then(data => {
        if(data){
          item._id = data
          Session.set('getAiModelsSettingsList', allData);
          Notify.success('AI artifact added');
        }
        Session.set(LOADING)
        $(MODAL).modal('hide');
      }).catch(function(error) {
        Notify.danger(error.reason || error.message || 'Could not add AI artifact');
        Session.set(LOADING);
      });
    }
  });

  $(MODAL).off('.AiModelsSettingsAddModal')
    .on('show.bs.modal.AiModelsSettingsAddModal', function (event) {
      $(FORM).validate().resetForm();
      const target = $(event.target);
      const editItem = Session.get(EDIT_ITEM);
      if (editItem) {
        populateForm(target, editItem);
      } else {
        resetForm(target);
      }
    })
    .on('hidden.bs.modal.AiModelsSettingsAddModal', function () {
      Session.set(EDIT_ITEM, null);   // leave edit mode when the modal closes
    });
});

Template.AiModelsSettingsAddModal.onDestroyed(function () {
  $(MODAL).off('.AiModelsSettingsAddModal');
  Session.set(EDIT_ITEM, null);
});

Template.AiModelsSettingsAddModal.events({
  'submit #AiModelsSettingsAddForm': function (event) {
    event.preventDefault();
  }
});

Template.AiModelsSettingsAddModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  isEditMode: function () {
    return !!Session.get(EDIT_ITEM);
  }
});

import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';

const FORM = '#AlgorithmsSettingsPolicyAddForm'
const MODAL = '#AlgorithmsSettingsPolicyAddModal'
const LOADING = 'loadingInProgress'


Template.AlgorithmsSettingsPolicyAddModal.onRendered(function () {
  Meteor.callAsync('getDenyAlgorithmChoices').then(data => {
    if(data){
      Session.set('getAlgorithmsSettings',data);
      Meteor.setTimeout(()=>{
        $('select.select2').select2({
          placeholder: '',
          width: '100%'
        });
      }, 100)
    }
  }).catch(function(error) {
    console.error('getDenyAlgorithmChoices failed:', error);
  })
  $(FORM).validate({
    rules: {
      addAlgorithm: {
        required: true
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
      const addAlgorithm = $(form).find('[name=addAlgorithm]').val();
      const comment = $(form).find('[name=comment]').val();
      const strength = $(form).find('[name=strength]').val();
      if (!addAlgorithm) {
        Notify.warn('Algorithm key is required');
      } else {
        Meteor.callAsync('blacklistedAlgorithms.add', {
          key: addAlgorithm,
          strength,
          comment
        }).then(data => {
          if(data){
            Notify.success('Algorithm blacklisted');
            const user = Meteor.user();
            Meteor.callAsync('logEvent', user, 'Blacklisted algorithm '+addAlgorithm+' added', 'blacklistedAlgorithmsProcessing').catch(function() {});
          }
          Session.set(LOADING)
          $(MODAL).modal('hide');
        }).catch(function(error) {
          Notify.danger(error.reason || error.message || 'Could not blacklist algorithm');
          Session.set(LOADING);
        });
      }
    }
  });

  $(MODAL).off('.AlgorithmsSettingsPolicyAddModal')
    .on('show.bs.modal.AlgorithmsSettingsPolicyAddModal', function (event) {
      $(FORM).validate().resetForm();
      $(event.target).find('[name=addAlgorithm]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=comment]').val('').trigger('change');
      $(event.target).find('[name=strength]').val('').trigger('change');
    });
});

Template.AlgorithmsSettingsPolicyAddModal.onDestroyed(function () {
  $(MODAL).off('.AlgorithmsSettingsPolicyAddModal');
});

Template.AlgorithmsSettingsPolicyAddModal.events({
  'submit #AlgorithmsSettingsPolicyAddForm': function (event) {
    event.preventDefault();
  }
});

Template.AlgorithmsSettingsPolicyAddModal.helpers({
  loading: function () {
    return Session.get(LOADING);
  },
  getAlgorithms: function () {
    let list = Session.get('getAlgorithmsSettings');
    if(list){
      list.unshift({Algorithm:''})
      return list
    }else{
      return []
    }
  }
});

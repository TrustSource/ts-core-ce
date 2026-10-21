 
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Random} from 'meteor/random';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import {COUNTERMEASURE_STATUS_VALUES} from '/imports/lib/schemas/riskSchema';

const FORM = '#RiskAddCountermeasureForm'
const MODAL = '#RiskAddCountermeasureModal'

function getData() {
  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  Meteor.callAsync('RiskProperties.Find', {moduleId, projectId}).then(function(data) {
    Session.set('getRiskSettingsList', _.sortBy((data ? data : []), 'created').reverse());
  }).catch(function(error) {
    console.error('RiskProperties.Find failed:', error);
  });
}

Template.riskAddCountermeasure.onRendered(function () {
  Session.set('WithNext');
  $('#RiskAddCountermeasureForm').validate({
    rules: {
      countermeasure: {
        required: true,
        minlength: 3,
        maxlength: 200
      }
    },
    messages: {
      countermeasure: {
        required: 'Countermeasure name is required',
        minlength: 'Countermeasure name must be at least 3 characters',
        maxlength: 'Countermeasure name must not exceed 200 characters'
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
      const countermeasure = $(form).find('[name=countermeasure]').val();
      const status = $(form).find('[name=status]').val();
      const comment = $(form).find('[name=comment]').val();
      const responsible = $(form).find('[name=responsible]').val();
      const riskReduction = $(form).find('[name=riskReduction]').val();
      const standardRef = $(form).find('[name=standardRef]').val();
      const validationMethod = $(form).find('[name=validationMethod]').val();
      const otmMitigationId = $(form).find('[name=otmMitigationId]').val();
      if(!countermeasure){
        Notify.warn('Countermeasure is required');
      }else {
        const _id = Session.get('editRiskDetails')
        const allData = Session.get('getRiskSettingsList')
        const current = _.find(allData, function (elem) {
          return elem._id === _id;
        })
        const self = {
          data: current.riskProperties.countermeasures
        }
        const item = {
          _id: Random.id(),
          countermeasure,
          status,
          comment,
          responsible,
          // schema expects Number - blank input must stay absent, not ''
          riskReduction: riskReduction === '' ? undefined : Number(riskReduction),
          standardRef,
          validationMethod,
          otmMitigationId
        }
        if(!self.data){
          self.data = [];
        }
        self.data.push(item)
        Meteor.callAsync(
          'RiskProperties.Update',
          {$set:{'riskProperties.countermeasures': self.data}},
          Session.get('editRiskDetails'),
          null
        ).then(() => {
          Notify.success('Countermeasure added');
          getData()
          if(Session.get('WithNext')){
            $(FORM).validate().resetForm();
            $(FORM).find('[name=countermeasure]').val('').trigger('change');
            $(FORM).find('[name=status]').val('').trigger('change');
            $(FORM).find('[name=comment]').val('').trigger('change');
            $(FORM).find('[name=responsible]').val([]).trigger('change');
            $(FORM).find('[name=riskReduction]').val('').trigger('change');
            $(FORM).find('[name=standardRef]').val('').trigger('change');
            $(FORM).find('[name=validationMethod]').val('').trigger('change');
            $(FORM).find('[name=otmMitigationId]').val('').trigger('change');
          }else{
            $(MODAL).modal('hide');
          }
        }).catch(error => {
          const message = 'Error: ' + (error.reason || 'Countermeasure: ' + countermeasure + ' not created');
          Notify.danger(message);
        });
      }
    }
  });
  this.autorun(function () {
    Meteor.setTimeout(function () {
      $('select.select2').select2({
        allowClear: true,
        width: '100%'
      });
    },1)
  });

  // Modals are moved to <body> on show (global handler) - Template.events
  // never fires inside. Bind delegated handlers on the modal element itself.
  $(MODAL).off('.riskAddCountermeasure')
    .on('submit.riskAddCountermeasure', FORM, function (event) {
      event.preventDefault();
    })
    .on('click.riskAddCountermeasure', '.without_next', function () {
      Session.set('WithNext');
    })
    .on('click.riskAddCountermeasure', '.with_next', function () {
      Session.set('WithNext', true);
    })
    .on('hide.bs.modal.riskAddCountermeasure', function () {
      $(FORM).validate().resetForm();
      $(FORM).find('[name=countermeasure]').val('').trigger('change');
      $(FORM).find('[name=status]').val('').trigger('change');
      $(FORM).find('[name=comment]').val('').trigger('change');
      $(FORM).find('[name=responsible]').val([]).trigger('change');
      $(FORM).find('[name=riskReduction]').val('').trigger('change');
      $(FORM).find('[name=standardRef]').val('').trigger('change');
      $(FORM).find('[name=validationMethod]').val('').trigger('change');
      $(FORM).find('[name=otmMitigationId]').val('').trigger('change');
    });
});

Template.riskAddCountermeasure.onDestroyed(function () {
  $(MODAL).off('.riskAddCountermeasure');
});

Template.riskAddCountermeasure.helpers({
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  getStatuses: function () {
    return COUNTERMEASURE_STATUS_VALUES
  },
  getUsers: function () {
    return Session.get('getUsers');
  }
});


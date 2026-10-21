 
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {Random} from 'meteor/random';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import Notify from '/imports/api/notify';
import {COUNTERMEASURE_STATUS_VALUES} from '/imports/lib/schemas/riskSchema';

const FORM = '#RiskEditCountermeasureForm'
const MODAL = '#RiskEditCountermeasureModal'

function getData() {
  const projectId = Router.current().params.query && Router.current().params.query.projectId;
  const moduleId = Router.current().params.query && Router.current().params.query.moduleId;
  Meteor.callAsync('RiskProperties.Find', {moduleId, projectId}).then(function(data) {
    Session.set('getRiskSettingsList', _.sortBy((data ? data : []), 'created').reverse());
  }).catch(function(error) {
    console.error('RiskProperties.Find failed:', error);
  });
}

Template.riskEditCountermeasure.onRendered(function () {
  Session.set('WithNext');
  $('#RiskEditCountermeasureForm').validate({
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
        // Preserve the edited row's _id (legacy rows without one get an id now);
        // match by _id so renaming the text doesn't orphan the row
        const original = Session.get('editCountermeasure') || {};
        const item = {
          _id: original._id || Random.id(),
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
        self.data = self.data.map(elem => {
          const isMatch = original._id ? elem._id === original._id
            : elem.countermeasure === item.countermeasure;
          if(isMatch){
            return item;
          }
          return elem
        })
        Meteor.callAsync(
          'RiskProperties.Update',
          {$set:{'riskProperties.countermeasures': self.data}},
          Session.get('editRiskDetails'),
          null
        ).then(() => {
          Notify.success('Countermeasure updated');
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
          const message = 'Error: ' + (error.reason || 'Countermeasure: ' + countermeasure + ' not updated');
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
  $(MODAL).off('.riskEditCountermeasure')
    .on('submit.riskEditCountermeasure', FORM, function (event) {
      event.preventDefault();
    })
    .on('click.riskEditCountermeasure', '.without_next', function () {
      Session.set('WithNext');
    })
    .on('click.riskEditCountermeasure', '.with_next', function () {
      Session.set('WithNext', true);
    })
    .on('show.bs.modal.riskEditCountermeasure', function () {
      $(FORM).validate().resetForm();
      let item = Session.get('editCountermeasure');
      $(FORM).find('[name=countermeasure]').val(item.countermeasure).trigger('change');
      $(FORM).find('[name=status]').val(item.status).trigger('change');
      $(FORM).find('[name=comment]').val(item.comment).trigger('change');
      $(FORM).find('[name=responsible]').val(item.responsible).trigger('change');
      $(FORM).find('[name=riskReduction]').val(item.riskReduction == null ? '' : item.riskReduction).trigger('change');
      $(FORM).find('[name=standardRef]').val(item.standardRef || '').trigger('change');
      $(FORM).find('[name=validationMethod]').val(item.validationMethod || '').trigger('change');
      $(FORM).find('[name=otmMitigationId]').val(item.otmMitigationId || '').trigger('change');
    })
    .on('hide.bs.modal.riskEditCountermeasure', function () {
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

Template.riskEditCountermeasure.onDestroyed(function () {
  $(MODAL).off('.riskEditCountermeasure');
});

Template.riskEditCountermeasure.helpers({
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


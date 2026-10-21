 
import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import Notify from '/imports/api/notify';
import {RISK_STATE_VALUES, RISK_ORIGIN_OPTIONS} from '/imports/lib/schemas/riskSchema';
import {readThreatModelContext, resetThreatModelFields} from '/imports/client/ui/common/risk-threat-model-fields/risk-threat-model-fields';

const FORM = '#RiskAddForm'
const MODAL = '#RiskAddModal'
const LOADING = 'loadingInProgress'
const F_BV = '[name=param_BV]'
const F_EF = '[name=param_EF]'
const F_ARO = '[name=param_ARO]'

Template.RiskAddModal.onRendered(function () {
  const template = Template.instance();
  Session.set('WithNext');
  $('.i-checks').iCheck({
    checkboxClass: 'icheckbox_square-green',
    radioClass: 'iradio_square-green'
  });
  $(FORM).validate({
    rules: {
      addRisk: {
        required: true,
        minlength: 3,
        maxlength: 200
      }
    },
    messages: {
      addRisk: {
        required: 'Risk name is required',
        minlength: 'Risk name must be at least 3 characters',
        maxlength: 'Risk name must not exceed 200 characters'
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
      const addRisk = $(form).find('[name=addRisk]').val();
      const origin = $(form).find('[name=origin]').val();
      const impactClass = $(form).find('[name=impactClass]').val();
      const confidentiality = $(form).find('[name=confidentiality]').is(':checked');
      const integrity = $(form).find('[name=integrity]').is(':checked');
      const availability = $(form).find('[name=availability]').is(':checked');
      const impactDescription = $(form).find('[name=impactDescription]').val();
      const impact = Session.get('ALE') || $(form).find('[name=impact]').val();
      const state = $(form).find('[name=state]').val();
      const param_BV = $(form).find(F_BV).val();
      const param_BV_enum = $(form).find('[name=param_BV_enum]').val();
      const param_EF = $(form).find(F_EF).val();
      const param_EF_enum = $(form).find('[name=param_EF_enum]').val();
      const param_ARO = $(form).find(F_ARO).val();
      const param_ARO_enum = $(form).find('[name=param_ARO_enum]').val();
      const threatModelContext = readThreatModelContext(form);
      if (!addRisk) {
        Notify.warn('Risk is required');
      } else {
        const self = template.data;
        let allData = Session.get('getRiskSettingsList');
        const item = {
          created: new Date(),
          name: addRisk,
          riskProperties: {
            origin,
            impactClass,
            confidentiality,
            integrity,
            availability,
            impactDescription,
            impact,
            state,
            BV: param_BV,
            BV_enum: param_BV_enum,
            EF: param_EF,
            EF_enum: param_EF_enum,
            ARO: param_ARO,
            ARO_enum: param_ARO_enum,
            // null (all fields empty) is dropped by Utils.cleanObject on create
            threatModelContext
          }
        }
        if (self.id === 'moduleCmpRisksSettings') {
          item.moduleId = self.docId;
        } else if (self.id === 'projCmpRisksSettings') {
          item.projectId = self.docId;
        }
        if (!allData) {
          allData = []
        }
        allData.push(item)
        Meteor.callAsync('RiskProperties.Create', item, null).then(data => {
          item._id = data
          Session.set('getRiskSettingsList', allData);
          Notify.success('Risk settings added');
          Session.set(LOADING)
          if(Session.get('WithNext')){
            $(FORM).validate().resetForm();
            Session.set('SLE')
            Session.set('ALE')
            $(FORM).find('[name=addRisk]').val('').trigger('change').removeClass('error');
            $(FORM).find('[name=origin]').val([]).trigger('change');
            $(FORM).find('[name=impactClass]').val('').trigger('change');
            $(FORM).find('[name=confidentiality]').prop('checked', false).trigger('change');
            $(FORM).find('[name=integrity]').prop('checked', false).trigger('change');
            $(FORM).find('[name=availability]').prop('checked', false).trigger('change');
            $('.i-checks').iCheck('update');
            $(FORM).find('[name=filename]').val('');
            $(FORM).find('[name=impactDescription]').val('');
            $(FORM).find('[name=impact]').val('');
            $(FORM).find('[name=state]').val('identified').trigger('change');
            $(FORM).find(F_BV).val('');
            $(FORM).find('[name=param_BV_enum]').val('').trigger('change');
            $(FORM).find(F_EF).val('');
            $(FORM).find('[name=param_EF_enum]').val('').trigger('change');
            $(FORM).find(F_ARO).val('');
            $(FORM).find('[name=param_ARO_enum]').val('').trigger('change');
            resetThreatModelFields(FORM);
            $('.i-checks').iCheck('update');
          }else{
            $(MODAL).modal('hide');
          }
        }).catch(error => {
          const message = 'Error: ' + (error.reason || 'Risk: ' + addRisk + ' not created');
          Notify.danger(message);
          Session.set(LOADING)
        });
      }
    }
  });
  const input = this.find('[name="param_BV"]');
  this.autorun(function () {
    if(input){
      // eslint-disable-next-line no-unused-vars
      input.addEventListener('input', (e) => {
        const cursorPos = input.selectionStart;
        let rawValue = input.value.replace(/\./g, '').replace(/\D/g, '');
        let formatted = Number(rawValue).toLocaleString('en-US');
        input.value = formatted;
        const diff = formatted.length - rawValue.length;
        const newCursorPos = cursorPos + diff;
        input.setSelectionRange(newCursorPos, newCursorPos);
      });
    }
  });

  // The global show.bs.modal handler moves modals to <body>, detaching them
  // from the Blaze template DOM range - Template.RiskAddModal.events never
  // fires for content inside the shown modal. Bind delegated handlers on the
  // modal element itself instead: they travel with it.
  $(MODAL).off('.RiskAddModal')
    .on('submit.RiskAddModal', '#RiskAddForm', function (event) {
      event.preventDefault();
    })
    .on('click.RiskAddModal', '.with_next', function () {
      Session.set('WithNext', true);
    })
    .on('click.RiskAddModal', '.without_next', function () {
      Session.set('WithNext');
    })
    .on('input.RiskAddModal', '#RiskAddForm .w-100', function (event) {
      event.preventDefault();
      calculateValue()
    })
    .on('click.RiskAddModal', '.switch_impact', function (event) {
      event.preventDefault();
      Session.set('simpleImpactView',!Session.get('simpleImpactView'))
      Meteor.setTimeout(function () {
        if(!Session.get('simpleImpactView')){
          $(MODAL + ' .simple_options .select2').select2({
            allowClear: true,
            width: '100%'
          }).trigger('change')
        }else{
          calculateValue()
        }
      }, 1)
    })
    .on('show.bs.modal.RiskAddModal', function (event) {
      $(FORM).validate().resetForm();
      Session.set('SLE')
      Session.set('ALE')
      $(event.target).find('[name=addRisk]').val('').trigger('change').removeClass('error');
      $(event.target).find('[name=origin]').val([]).trigger('change');
      $(event.target).find('[name=impactClass]').val('').trigger('change');
      $(event.target).find('[name=confidentiality]').prop('checked', false).trigger('change');
      $(event.target).find('[name=integrity]').prop('checked', false).trigger('change');
      $(event.target).find('[name=availability]').prop('checked', false).trigger('change');
      $('.i-checks').iCheck('update');
      $(event.target).find('[name=impactDescription]').val('');
      $(event.target).find('[name=impact]').val('');
      $(event.target).find('[name=state]').val('identified').trigger('change');
      $(event.target).find(F_BV).val('');
      $(event.target).find('[name=param_BV_enum]').val('').trigger('change');
      $(event.target).find(F_EF).val('');
      $(event.target).find('[name=param_EF_enum]').val('').trigger('change');
      $(event.target).find(F_ARO).val('');
      $(event.target).find('[name=param_ARO_enum]').val('').trigger('change');
      resetThreatModelFields(event.target);
      $('.i-checks').iCheck('update');
      Meteor.setTimeout(()=>{
        $(MODAL + ' select.select2').select2({
          placeholder: '',
          width: '100%'
        });
      }, 100)
    });
});

Template.RiskAddModal.onDestroyed(function () {
  $(MODAL).off('.RiskAddModal');
});

function calculateValue() {
  let modal = $(MODAL)
  let BV = modal.find(F_BV).val().replace(/,/g, '');
  let EF = modal.find(F_EF).val()
  let ARO = modal.find(F_ARO).val()
  Session.set('SLE')
  Session.set('ALE')
  if(BV && EF){
    // round to 2 decimals - integer rounding turned small results (e.g.
    // 1 EUR * 2% = 0.02) into 0, which {{#if paramSLE}} then hid entirely
    let SLE = Math.round(Number(BV) * Number(EF)) / 100
    Session.set('SLE', SLE)
    if(SLE && ARO){
      let ALE = Math.round(Number(SLE) * Number(ARO) * 100) / 100
      Session.set('ALE', ALE)
    }
  }
}

Template.RiskAddModal.helpers({
  currencyCode: function () {
    const company = Session.get('company');
    return company && company.currencyCode && company.currencyCode.length ? company.currencyCode : 'EUR'
  },
  simpleImpactView: function () {
    return !Session.get('simpleImpactView')
  },
  originValues: function () {
    return RISK_ORIGIN_OPTIONS
  },
  impactClassValues: function () {
    return [
      '',
      'low',
      'moderate',
      'high',
      'critical',
      'existential'
    ]
  },
  stateValues: function () {
    return RISK_STATE_VALUES
  },
  valueValues: function () {
    return [
      '',
      'low',
      'moderate',
      'high'
    ]
  },
  annualRateValues: function () {
    return [
      {
        value: '',
        label: ''
      },{
        value: 'likely',
        label: 'likely (once a year)'
      },{
        value: 'unlikely',
        label: 'unlikely (< once a year)'
      },{
        value: 'rare',
        label: 'rare (every 2 years or less)'
      }
    ]
  },
  getCheck: function (item) {
    return this[item]
  },
  loading: function () {
    return Session.get(LOADING);
  },
  formatNumber: function (value) {
    return value ? Number(value).toLocaleString() : ''
  },
  paramSLE: function () {
    return Session.get('SLE')
  },
  paramALE: function () {
    return Session.get('ALE')
  }
});

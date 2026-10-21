import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Tracker} from 'meteor/tracker';
import {$} from 'meteor/jquery';
import {Session} from 'meteor/session';
import {ReactiveTable} from 'meteor/aslagle:reactive-table';
import Notify from '/imports/api/notify';
import {RISK_STATE_VALUES, RISK_ORIGIN_OPTIONS, UNTOUCHED_RISK_STATES} from '/imports/lib/schemas/riskSchema';
import {readThreatModelContext, resetThreatModelFields} from '/imports/client/ui/common/risk-threat-model-fields/risk-threat-model-fields';
import {cweLakeUrl} from '/imports/client/ui/helpers/template-helpers';
import {SOURCE_REF_LEVELS, SOURCE_REF_LEVEL_LABEL} from '/imports/lib/sarif/cweRiskPlan';

const FORM = '#RiskEditForm'
const LOADING = 'loadingInProgress'
const F_BV = '[name=param_BV]'
const F_EF = '[name=param_EF]'
const F_ARO = '[name=param_ARO]'
const F_STATE = '[name=state]'
const SOURCE_REFS_TABLE_ID = 'riskSourceRefs'
const SOURCE_REFS_FILTER_ID = SOURCE_REFS_TABLE_ID + '-filter'
const SOURCE_REFS_SCOPE = '.risk-source-refs'
const NO_FILE_LABEL = '(no file)'
const COL_LEVEL = 'risk-source-col-level'
const ENTER_KEY = 13

// --- Pure source-reference derivations -------------------------
// Kept free of Meteor/jQuery/DOM so they can be executed directly by
// test_api/specs/risk-source-refs-summary.frontend.unit.spec.js - there is no
// Blaze render harness in this repo, so extracted pure functions are the only
// real coverage available for template logic.

// `uri` and `ruleId` come straight out of an uploaded SARIF document and can
// spell `__proto__`; a plain object literal would swallow that as a prototype
// assignment and undercount, hence Object.create(null).
export function countSourceRefs(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const files = Object.create(null);
  const rules = Object.create(null);
  let findings = 0;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] || {};
    findings += Number(entry.count) || 0;
    if (entry.uri) {
      files[entry.uri] = true;
    }
    if (entry.ruleId) {
      rules[entry.ruleId] = true;
    }
  }
  return {
    findings: findings,
    files: Object.keys(files).length,
    rules: Object.keys(rules).length,
    shown: list.length
  };
}

export function pluralizeCount(count, noun) {
  return count + ' ' + noun + (count === 1 ? '' : 's');
}

// The whole counts line, pre-pluralized, so the template carries no plural logic
// and no `{{helper arg}}` call (which throws "No such function" when the data
// context is momentarily undefined on a cold load).
export function summarizeSourceRefs(entries, sourceRefsTotal, truncated) {
  const counts = countSourceRefs(entries);
  const head = pluralizeCount(counts.findings, 'finding') + ' · ' +
    pluralizeCount(counts.files, 'file') + ' · ' +
    pluralizeCount(counts.rules, 'rule') + ' · ';
  // AC12: the counts above are derived from the CAPPED list, so a truncated
  // Risk must say so here too - not only in the tab pane's warning.
  return truncated ?
    head + 'counted from the first ' + counts.shown + ' of ' + (Number(sourceRefsTotal) || 0) + ' occurrences' :
    head + pluralizeCount(counts.shown, 'occurrence');
}

// A decorated COPY - the stored array is Session-held and shared with the risk
// list, so it is never mutated. Decorating here keeps `uriLabel`/`levelLabel`
// out of the template as `{{helper arg}}` calls.
export function decorateSourceRefs(entries, levelLabels) {
  const labels = levelLabels || {};
  return (Array.isArray(entries) ? entries : []).map(function (entry) {
    const row = entry || {};
    const uri = row.uri ? String(row.uri) : '';
    const level = row.level ? String(row.level) : '';
    // hasOwnProperty, not a bare lookup: a level of 'constructor' would
    // otherwise resolve through the prototype chain into the table cell.
    const levelLabel = Object.prototype.hasOwnProperty.call(labels, level) ? labels[level] : level;
    return {
      tool: row.tool ? String(row.tool) : '',
      ruleId: row.ruleId ? String(row.ruleId) : '',
      uri: uri,
      uriLabel: uri || NO_FILE_LABEL,
      level: level,
      levelLabel: levelLabel,
      count: Number(row.count) || 0
    };
  });
}

// Every read goes through here so a cold load with no data context cannot throw.
function riskProps() {
  const instance = Template.instance();
  const data = instance && instance.data && instance.data.data;
  return (data && data.riskProperties) || {};
}

function storedSourceRefs() {
  const refs = riskProps().sourceRefs;
  return Array.isArray(refs) ? refs : [];
}

Template.RiskEdit.onRendered(function () {
  const template = Template.instance();
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
      const generalApproach = $(form).find('[name=generalApproach]').val();
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
      let simple = !Session.get('simpleImpactView')
      if (!addRisk) {
        Notify.warn('Risk is required');
      } else {
        const self = template.data;
        let allData = Session.get('getRiskSettingsList');
        const item = self.data
        const modifier = {
          $set:{
            name: addRisk,
            'riskProperties.generalApproach': generalApproach,
            'riskProperties.origin': origin,
            'riskProperties.impactClass': impactClass,
            'riskProperties.confidentiality': confidentiality,
            'riskProperties.integrity': integrity,
            'riskProperties.availability': availability,
            'riskProperties.impactDescription': impactDescription,
            'riskProperties.impact': impact,
            'riskProperties.state': state,
            'riskProperties.BV': param_BV,
            'riskProperties.BV_enum': param_BV_enum,
            'riskProperties.EF': param_EF,
            'riskProperties.EF_enum': param_EF_enum,
            'riskProperties.ARO': param_ARO,
            'riskProperties.ARO_enum': param_ARO_enum
          }
        }
        if (threatModelContext) {
          modifier.$set['riskProperties.threatModelContext'] = threatModelContext;
        } else {
          // all fields cleared - remove the context instead of storing a stub
          modifier.$unset = {'riskProperties.threatModelContext': ''};
        }
        if (!allData) {
          allData = []
        }
        allData = allData.map(itm=>{
          if(itm._id === item._id) {
            itm = item
            itm.name = addRisk;
            itm.riskProperties.origin = origin;
            itm.riskProperties.generalApproach = generalApproach;
            itm.riskProperties.impactClass = impactClass;
            itm.riskProperties.confidentiality = confidentiality;
            itm.riskProperties.integrity = integrity;
            itm.riskProperties.availability = availability;
            itm.riskProperties.impactDescription = impactDescription;
            itm.riskProperties.impact = impact;
            itm.riskProperties.state = state;
            if (threatModelContext) {
              itm.riskProperties.threatModelContext = threatModelContext;
            } else {
              delete itm.riskProperties.threatModelContext;
            }
            if(simple){
              itm.riskProperties.BV_enum = param_BV_enum;
              itm.riskProperties.EF_enum = param_EF_enum;
              itm.riskProperties.ARO_enum = param_ARO_enum;
            }else{
              itm.riskProperties.BV = param_BV;
              itm.riskProperties.EF = param_EF;
              itm.riskProperties.ARO = param_ARO;
            }
          }
          return itm;
        })
        Meteor.callAsync('RiskProperties.Update', modifier, item._id, null).then(() => {
          Notify.success('Risk settings updated');
          Session.set('getRiskSettingsList', allData);
          Session.set(LOADING)
        }).catch(error => {
          const message = 'Error: ' + (error.reason || 'Risk: ' + addRisk + ' not updated');
          Notify.danger(message);
          Session.set(LOADING)
        });
      }
    }
  });
  // a11y: the reactiveTable filter ships with a placeholder and no label, so the
  // occurrence table's filter would be an unnamed input to a screen reader.
  Tracker.afterFlush(function () {
    if (!template.view || template.view.isDestroyed) {
      return;
    }
    template.$(SOURCE_REFS_SCOPE + ' .reactive-table-input')
      .attr('aria-label', 'Filter source references by rule or file');
  });
  const input = this.find('[name="param_BV"]');
  this.autorun(function () {
    if(Session.get('editRiskDetails')){
      Meteor.setTimeout(function () {
        calculateValue();
        $('.i-checks').iCheck('update');
        $('#RiskEditForm select.select2').select2({
          allowClear: true,
          width: '100%'
        }).trigger('change')
      },1)
    }
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
});

Template.RiskEdit.onCreated(function RiskEdit_onCreated() {
  Meteor.setTimeout(function () {
    calculateValue();
    $('#RiskEditForm select.select2:visible').select2({
      allowClear: true,
      width: '100%'
    });
    $('input.i-checks').trigger('change').iCheck('update');
  },300)
});

Template.RiskEdit.onDestroyed(function RiskEdit_onDestroyed() {
  $(FORM).validate().resetForm();
  Session.set('SLE')
  Session.set('ALE')
  $(FORM).find('[name=addRisk]').val('').trigger('change').removeClass('error');
  $(FORM).find('[name=origin]').val([]).trigger('change');
  $(FORM).find('[name=generalApproach]').val('').trigger('change');
  $(FORM).find('[name=impactClass]').val('').trigger('change');
  $(FORM).find('[name=confidentiality]').prop('checked', false).trigger('change');
  $(FORM).find('[name=integrity]').prop('checked', false).trigger('change');
  $(FORM).find('[name=availability]').prop('checked', false).trigger('change');
  $(FORM).find('[name=filename]').val('');
  $(FORM).find('[name=impactDescription]').val('');
  $(FORM).find('[name=impact]').val('');
  $(FORM).find('[name=state]').val('').trigger('change');
  $(FORM).find(F_BV).val('');
  $(FORM).find('[name=param_BV_enum]').val('').trigger('change');
  $(FORM).find(F_EF).val('');
  $(FORM).find('[name=param_EF_enum]').val('').trigger('change');
  $(FORM).find(F_ARO).val('');
  $(FORM).find('[name=param_ARO_enum]').val('').trigger('change');
  resetThreatModelFields(FORM);
  // reactive-table keeps its filters in a module-global map keyed by table id, so
  // without this a filter typed on Risk A silently applies to Risk B.
  ReactiveTable.clearFilters([SOURCE_REFS_FILTER_ID]);
  $('.i-checks').iCheck('update');
  Meteor.setTimeout(function () {
    Session.set('editRiskDetails')
  },300)
});

Template.RiskEdit.events({
  'submit #RiskEditForm': function (event) {
    event.preventDefault();
  },
  'input #RiskEditForm .w-100': function (event) {
    event.preventDefault();
    calculateValue()
  },
  'click .back_to_list': function (event) {
    event.preventDefault();
    Session.set('editRiskDetails')
  },
  'click .switch_impact': function (event) {
    event.preventDefault();
    Session.set('simpleImpactView',!Session.get('simpleImpactView'))
    Meteor.setTimeout(function () {
      calculateValue();
      $('#RiskEditForm select.select2:visible').select2({
        allowClear: true,
        width: '100%'
      }).trigger('change')
    }, 1)
  },
  // "0 of N occurrences still active" banner: moves focus into the existing State
  // control and opens it. Selects no value, saves nothing, calls no method.
  'click .risk-goto-state': function (event) {
    event.preventDefault();
    const state = $(FORM).find(F_STATE);
    if (!state.length) {
      return;
    }
    const container = state.next('.select2-container');
    const target = (container.length ? container : state)[0];
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({block: 'center'});
    }
    if (state.data('select2')) {
      state.select2('open');
    } else {
      state.trigger('focus');
    }
  },
  // The reactiveTable filter and both pagination inputs are plain <input>s
  // rendered INSIDE #RiskEditForm, so Enter in any of them would reach
  // jquery-validation's submitHandler and save the Risk.
  'keydown .risk-source-refs input': function (event) {
    if (event.which === ENTER_KEY) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
});

function calculateValue() {
  let form = $(FORM)
  let simple = Session.get('simpleImpactView')
  if(form && simple){
    let BV = form.find(F_BV).val().replace(/,/g, '');
    let EF = form.find(F_EF).val()
    let ARO = form.find(F_ARO).val()
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
}

Template.RiskEdit.helpers({
  currencyCode: function () {
    const company = Session.get('company');
    return company && company.currencyCode && company.currencyCode.length ? company.currencyCode : 'EUR'
  },
  simpleImpactView: function () {
    return !Session.get('simpleImpactView')
  },
  getCountermeasures: function () {
    const template = Template.instance();
    const data = template && template.data && template.data.data;
    return data.riskProperties.countermeasures
  },
  originValues: function () {
    return RISK_ORIGIN_OPTIONS
  },
  generalApproachValues: function () {
    return [
      '',
      'ignore',
      'transfer',
      'mitigate',
      'resolve'
    ]
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
  // Older risks hold the C/I/A flags as 'true'/'false' strings ('false' is truthy).
  isChecked: function (item) {
    const value = this && this[item];
    return value === true || value === 'true'
  },
  isSelected: function (item, value) {
    const template = Template.instance();
    const props = template && template.data && template.data.data && template.data.data.riskProperties;
    const stored = props && props[item];
    // strict boolean - returning '' (e.g. stored empty string && short-circuit)
    // would render selected="" on every option and leave the last one selected
    return !!(stored === value || (stored && stored.indexOf(value) > -1));
  },
  isFormDisabled: function () {
    const template = Template.instance();
    const id = template && template.data && template.data.id;
    const data = template && template.data && template.data.data;
    const disabled = (id === 'projCmpRisksSettings' && !data.projectId) || (id === 'moduleCmpRisksSettings' && !data.moduleId)
    return disabled ? 'disabled' : false
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
  },

  // --- Auto-created risks: provenance + source references -------
  // All pure reads of Template.instance().data.data.riskProperties.
  //
  // Gated on `autoTool`, NOT on `autoKey`: `autoKey` only says "some importer
  // owns this risk", and manual license resolution added a second one. A LIC risk carries an
  // autoKey with no autoCwe and no autoTool, so on `autoKey` it rendered an
  // empty CWE badge, an empty tool name, a sentence about SARIF imports that
  // never touch it, and an empty Occurrences tab.
  isSarifManaged: function () {
    return !!riskProps().autoTool;
  },
  // The license a manual resolution recorded for the component this risk was
  // created for.
  autoLicense: function () {
    return riskProps().autoLicense;
  },
  autoCwe: function () {
    return riskProps().autoCwe;
  },
  autoTool: function () {
    return riskProps().autoTool;
  },
  // Exists so the template never writes `{{cweLakeUrl autoCwe}}` - a
  // mustache-with-args throws "No such function" when the data context is
  // momentarily undefined on a cold load. The `{{#if}}` around the anchor also
  // keeps a bare href="" (which full-page-reloads the SPA) impossible.
  autoCweLakeUrl: function () {
    return cweLakeUrl(riskProps().autoCwe);
  },
  sourceRefs: function () {
    return decorateSourceRefs(storedSourceRefs(), SOURCE_REF_LEVEL_LABEL);
  },
  sourceRefsShown: function () {
    return storedSourceRefs().length;
  },
  sourceRefsTotal: function () {
    const props = riskProps();
    return typeof props.sourceRefsTotal === 'number' ?
      props.sourceRefsTotal :
      storedSourceRefs().length;
  },
  sourceRefsTruncated: function () {
    return !!riskProps().sourceRefsTruncated;
  },
  sourceRefsPrevCount: function () {
    return Number(riskProps().sourceRefsPrevCount) || 0;
  },
  // Deliberately requires a prior count: an auto risk that has never had a
  // finding shows the ordinary empty state, not a "ready to close?" prompt.
  sourceRefsAllGone: function () {
    const props = riskProps();
    // `autoTool`, like the strip above: the body of this prompt names the tool
    // and the CWE, so it must not be reachable from an autoKey a non-SARIF
    // importer wrote.
    return !!props.autoTool && storedSourceRefs().length === 0 &&
      (Number(props.sourceRefsPrevCount) || 0) > 0;
  },
  sourceRefsFindingCount: function () {
    return countSourceRefs(storedSourceRefs()).findings;
  },
  sourceRefsFileCount: function () {
    return countSourceRefs(storedSourceRefs()).files;
  },
  sourceRefsRuleCount: function () {
    return countSourceRefs(storedSourceRefs()).rules;
  },
  sourceRefsSummary: function () {
    const props = riskProps();
    const refs = storedSourceRefs();
    const total = typeof props.sourceRefsTotal === 'number' ? props.sourceRefsTotal : refs.length;
    return summarizeSourceRefs(refs, total, !!props.sourceRefsTruncated);
  },
  autoRefreshPaused: function () {
    return UNTOUCHED_RISK_STATES.indexOf(riskProps().state) !== -1;
  },
  sourceRefsTableSettings: function () {
    return {
      // A stable id is what keeps the filter text alive across recomputes - and
      // what makes the onDestroyed clearFilters() call addressable.
      id: SOURCE_REFS_TABLE_ID,
      collection: decorateSourceRefs(storedSourceRefs(), SOURCE_REF_LEVEL_LABEL),
      rowsPerPage: 15,
      showFilter: true,
      showRowCount: true,
      showNavigation: 'auto',
      showColumnToggles: false,
      useFontAwesome: true,
      class: 'table table-condensed risk-source-refs-table',
      noDataTmpl: Template.reactiveTableNoData,
      // headerClass/cellClass are set on EVERY column on purpose: reactive-table
      // falls back to `this.key` when they are undefined, which would emit a
      // `uri` class and lose the fixed column widths the ellipsis depends on.
      fields: [
        {
          fieldId: 'level',
          key: 'level',
          label: 'Level',
          fn: function (value, object) {
            return object.levelLabel;
          },
          headerClass: COL_LEVEL,
          cellClass: function (value) {
            // Whitelisted: `value` is planner-constrained, but it lands in a
            // class name, so an unexpected level gets no level modifier at all.
            return SOURCE_REF_LEVELS.indexOf(value) === -1 ?
              COL_LEVEL :
              COL_LEVEL + ' risk-source-level risk-source-level-' + value;
          },
          sortFn: function (value) {
            return SOURCE_REF_LEVELS.indexOf(value);
          }
        },
        {
          fieldId: 'ruleId',
          key: 'ruleId',
          label: 'Rule',
          tmpl: Template.reactiveTableRiskSourceRule,
          headerClass: 'risk-source-col-rule',
          cellClass: 'risk-source-col-rule',
          sortOrder: 0,
          sortDirection: 'ascending'
        },
        {
          fieldId: 'uri',
          key: 'uri',
          label: 'File',
          tmpl: Template.reactiveTableRiskSourceFile,
          headerClass: 'risk-source-col-file',
          cellClass: 'risk-source-col-file'
        },
        {
          fieldId: 'count',
          key: 'count',
          label: 'Findings',
          headerClass: 'risk-source-col-count',
          cellClass: 'risk-source-col-count'
        }
      ]
    };
  }
});

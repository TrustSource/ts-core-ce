import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Tracker} from 'meteor/tracker';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {STRIDE_CATEGORIES} from '/imports/lib/schemas/riskSchema';

// Shared threat-model-context form section, embedded in RiskAddModal and
// RiskEdit. Parent forms read/reset the fields by name via the helpers
// exported below. Data context (all optional):
//   tmc      - existing threatModelContext object (edit population)
//   disabled - truthy to render all inputs disabled

function currentTmc() {
  const data = Template.currentData();
  return (data && data.tmc) || {};
}

// select2 tags:true appends its own <option> elements outside Blaze's
// {{#each}} range; they survive re-renders, so after a save the Blaze-rendered
// options double them. Keep the first occurrence (Blaze's), drop the rest.
function dedupeTagOptions(template) {
  template.$('select.select2-tm-tags').each(function () {
    const seen = {};
    let removed = false;
    $(this).find('option').each(function () {
      if (seen[this.value]) {
        $(this).remove();
        removed = true;
      } else {
        seen[this.value] = true;
      }
    });
    if (removed) {
      $(this).trigger('change'); // redraw select2 tags
    }
  });
}

Template.riskThreatModelFields.onRendered(function () {
  const template = this;
  Meteor.setTimeout(function () {
    if (template.view.isDestroyed) return;
    dedupeTagOptions(template);
    // Distinct classes keep these out of the parents' generic
    // $('select.select2').select2(...) re-inits, which would drop the tags config.
    template.$('select.select2-tm').select2({
      allowClear: true,
      width: '100%'
    });
    template.$('select.select2-tm-tags').select2({
      tags: true,
      width: '100%',
      language: {
        noResults: function () {
          return 'Type a CWE id, e.g. CWE-89, and press Enter';
        }
      }
    });
  }, 1);
  // data-context changes (e.g. after save) only patch the option list - the
  // template instance survives, so re-run the dedupe after each flush
  this.autorun(function () {
    Template.currentData();
    Tracker.afterFlush(function () {
      dedupeTagOptions(template);
    });
  });
});

Template.riskThreatModelFields.helpers({
  strideOptions: function () {
    const selected = currentTmc().strideCategories || [];
    return STRIDE_CATEGORIES.map(function (value) {
      // boolean, not '' - in value position Blaze only omits the attribute
      // for false/null; an empty string would still mark the option selected
      return {value, selected: selected.indexOf(value) > -1};
    });
  },
  cweOptions: function () {
    return currentTmc().cwes || [];
  },
  tmc: function () {
    return currentTmc();
  },
  trustBoundaryChecked: function () {
    return !!currentTmc().trustBoundaryCrossing;
  },
  disabledAttr: function () {
    const data = Template.currentData();
    return data && data.disabled ? 'disabled' : '';
  }
});

// Reads the tm* fields from a form element/selector and returns a
// threatModelContext object, or null when every field is empty (so untouched
// forms don't persist a stub object).
export function readThreatModelContext(form) {
  // dedupe - duplicate <option> elements (Blaze + select2-created) would
  // otherwise yield repeated values
  const strideCategories = _.uniq($(form).find('[name=tmStride]').val() || []);
  const cwes = _.uniq($(form).find('[name=tmCwes]').val() || []);
  const enisaCategory = $(form).find('[name=tmEnisaCategory]').val();
  const enisaThreat = $(form).find('[name=tmEnisaThreat]').val();
  const affectedElementType = $(form).find('[name=tmAffectedElementType]').val();
  const trustBoundaryCrossing = $(form).find('[name=tmTrustBoundaryCrossing]').is(':checked');
  const tmRunId = $(form).find('[name=tmRunId]').val();
  const tmMethod = $(form).find('[name=tmMethod]').val();
  const otmThreatId = $(form).find('[name=tmOtmThreatId]').val();
  const isEmpty = !strideCategories.length && !cwes.length && !enisaCategory && !enisaThreat
    && !affectedElementType && !trustBoundaryCrossing && !tmRunId && !tmMethod && !otmThreatId;
  if (isEmpty) {
    return null;
  }
  return {
    strideCategories,
    enisaCategory,
    enisaThreat,
    cwes,
    affectedElementType,
    trustBoundaryCrossing,
    tmRunId,
    tmMethod,
    otmThreatId
  };
}

// Clears the tm* fields (used by parents' reset/show handlers). The caller is
// responsible for the trailing $('.i-checks').iCheck('update') refresh.
export function resetThreatModelFields(form) {
  $(form).find('[name=tmStride]').val([]).trigger('change');
  $(form).find('[name=tmCwes]').val([]).trigger('change');
  $(form).find('[name=tmEnisaCategory]').val('');
  $(form).find('[name=tmEnisaThreat]').val('');
  $(form).find('[name=tmAffectedElementType]').val('');
  $(form).find('[name=tmTrustBoundaryCrossing]').prop('checked', false);
  $(form).find('[name=tmRunId]').val('');
  $(form).find('[name=tmMethod]').val('');
  $(form).find('[name=tmOtmThreatId]').val('');
}

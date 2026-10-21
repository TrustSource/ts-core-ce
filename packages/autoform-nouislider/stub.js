/* global AutoForm */
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import noUiSlider from 'nouislider';
import 'nouislider/dist/nouislider.css';
import './nouislider.html';

function getSchemaMinMax(fieldName) {
  var min = 0;
  var max = 100;
  try {
    var ss = AutoForm.getFormSchema();
    if (ss && fieldName) {
      var fieldDef = ss.getDefinition ? ss.getDefinition(fieldName) : null;
      if (fieldDef) {
        // Top-level (SimpleSchema 1.x compat)
        if (fieldDef.min !== undefined) min = fieldDef.min;
        if (fieldDef.max !== undefined) max = fieldDef.max;
        // Inside type definitions (SimpleSchema 2.x — min/max are oneOfProps)
        if (fieldDef.type && fieldDef.type[0]) {
          if (fieldDef.type[0].min !== undefined) min = fieldDef.type[0].min;
          if (fieldDef.type[0].max !== undefined) max = fieldDef.type[0].max;
        }
      }
    }
  } catch (e) {
    // ignore schema lookup failures
  }
  return { min: min, max: max };
}

AutoForm.addInputType('noUiSlider', {
  template: 'afNoUiSlider',
  valueOut: function () {
    var slider = this[0] && this[0].noUiSlider;
    if (slider) {
      var val = slider.get();
      return Array.isArray(val) ? parseFloat(val[0]) : parseFloat(val);
    }
    return this.data('value');
  },
  valueIn: function (val) {
    return val;
  },
  contextAdjust: function (context) {
    if (context.atts) {
      // Move object-valued options out of atts → context root,
      // so {{atts}} doesn't try to serialize them as HTML attributes
      context.noUiSliderOptions = context.atts.noUiSliderOptions || {};
      context.noUiSlider_pipsOptions = context.atts.noUiSlider_pipsOptions;
      delete context.atts.noUiSliderOptions;
      delete context.atts.noUiSlider_pipsOptions;
    }

    // Extract min/max from schema while we're in the autoForm helper context
    var range = getSchemaMinMax(context.name);
    context.schemaMin = range.min;
    context.schemaMax = range.max;

    return context;
  }
});

Template.afNoUiSlider.onCreated(function () {
  this._sliderValue = new ReactiveVar(this.data.value);
});

Template.afNoUiSlider.onRendered(function () {
  var self = this;
  var data = self.data;
  var $slider = self.$('.at-nouislider');
  var sliderEl = $slider[0];

  if (!sliderEl) return;

  // Options moved to context root by contextAdjust (out of atts)
  var sliderOpts = data.noUiSliderOptions || {};
  var pipsOpts = data.noUiSlider_pipsOptions;

  // min/max extracted from schema by contextAdjust
  var min = data.schemaMin !== undefined ? data.schemaMin : 0;
  var max = data.schemaMax !== undefined ? data.schemaMax : 100;

  // Allow explicit range override via options
  if (sliderOpts.range) {
    if (sliderOpts.range.min !== undefined) min = sliderOpts.range.min;
    if (sliderOpts.range.max !== undefined) max = sliderOpts.range.max;
  }

  var start = (data.value !== undefined && data.value !== null) ? data.value : min;

  var opts = {
    start: start,
    range: { min: min, max: max },
    step: sliderOpts.step || 1,
  };

  if (sliderOpts.connect) {
    opts.connect = sliderOpts.connect;
  }

  if (sliderOpts.tooltips) {
    opts.tooltips = sliderOpts.tooltips;
  }

  if (pipsOpts) {
    opts.pips = pipsOpts;
  }

  noUiSlider.create(sliderEl, opts);

  sliderEl.noUiSlider.on('update', function (values) {
    var val = parseFloat(values[0]);
    self._sliderValue.set(val);
    $slider.data('value', val);
    $slider.trigger('change');
  });

  // Reactively update slider when autoform value changes
  self.autorun(function () {
    var currentData = Template.currentData();
    if (currentData && currentData.value !== undefined && currentData.value !== null) {
      var slider = sliderEl.noUiSlider;
      if (slider) {
        var currentVal = parseFloat(slider.get());
        if (currentVal !== currentData.value) {
          slider.set(currentData.value);
        }
      }
    }
  });
});

Template.afNoUiSlider.onDestroyed(function () {
  var sliderEl = this.$('.at-nouislider')[0];
  if (sliderEl && sliderEl.noUiSlider) {
    sliderEl.noUiSlider.destroy();
  }
});

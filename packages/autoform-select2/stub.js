/* global AutoForm */
import { Template } from 'meteor/templating';
import './select2.html';

AutoForm.addInputType('select2', {
  template: 'afSelect2',
  valueOut: function () {
    var val = this.val();
    if (this.prop('multiple')) {
      return val;
    }
    return val || undefined;
  },
  valueIsArray: false,
  contextAdjust: function (context) {
    var itemAtts = Object.assign({}, context.atts);
    var isMultiple = itemAtts.multiple || false;

    // Build items list from selectOptions
    context.items = (context.selectOptions || []).map(function (opt) {
      if (opt.optgroup) {
        return {
          optgroup: opt.optgroup,
          options: (opt.options || []).map(function (subOpt) {
            return {
              label: subOpt.label,
              value: subOpt.value,
              selected: isMultiple
                ? (Array.isArray(context.value) && context.value.indexOf(subOpt.value) > -1)
                : (context.value === subOpt.value)
            };
          })
        };
      }
      return {
        label: opt.label,
        value: opt.value,
        selected: isMultiple
          ? (Array.isArray(context.value) && context.value.indexOf(opt.value) > -1)
          : (context.value === opt.value)
      };
    });

    // Check if we need a blank option
    context.hasBlankOption = !isMultiple && (!context.value || context.value === '');

    return context;
  }
});

Template.afSelect2.onRendered(function () {
  var $select = this.$('select');
  var atts = this.data.atts || {};
  var select2Opts = atts.select2Options || {};
  select2Opts.width = select2Opts.width || '100%';

  $select.select2(select2Opts);

  // When autoform reactively updates the value, update select2
  this.autorun(function () {
    var data = Template.currentData();
    if (data && data.value !== undefined) {
      $select.val(data.value).trigger('change.select2');
    }
  });
});

Template.afSelect2.onDestroyed(function () {
  var $select = this.$('select');
  if ($select.data('select2')) {
    $select.select2('destroy');
  }
});

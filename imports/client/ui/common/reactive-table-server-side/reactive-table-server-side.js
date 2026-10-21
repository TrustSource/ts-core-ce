import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {ReactiveVar} from 'meteor/reactive-var'
import {Session} from 'meteor/session';
import {Tracker} from 'meteor/tracker';
import _ from 'underscore';
import {$} from 'meteor/jquery';
import Pluralize from 'pluralize';
import Notify from '/imports/api/notify';
import Utils from '/imports/lib/utils';

function getTableData(data, template) {
  template.loading.set(true);
  const search = template.search;
  const filters = template.filters && template.filters.get();
  const hasAdvancedFilter = !!(data.options.hasAdvanced && filters && filters.length);
  const activeOrder = template.order && template.order.get();
  const activeSorting = template.sort && template.sort.get();
  const defaultSort = data.options && data.options.sort ? Object.keys(data.options.sort)[0] : '';
  const defaultOrder = data.options && data.options.sort ? Object.values(data.options.sort)[0] : 'asc';
  const sort = activeSorting ? activeSorting : defaultSort;
  const order = activeOrder ? activeOrder : defaultOrder;
  let selector = data.options && data.options.selector || null;
  const hasSearch = search.get() && search.get().trim().length > 0;
  if((hasSearch && data.filters && data.filters.length) || hasAdvancedFilter){
    let advValue = hasAdvancedFilter ? {$and: filters.map((field)=>{
      if (field.type && field.type === 'date'){
        return {[(field.key || field)]: {$gte:new Date(`${field.value}T00:00:00.000Z`), $lte:new Date(`${field.value}T23:59:59.999Z`)}}
      }else if (field.type === 'select'){
        // Equality - uses btree indexes (unlike regex) and avoids per-doc scan.
        return {[(field.key || field)]: field.value}
      }else{
        // Bare escaped term - `$regex` already matches substrings; the prior
        // `^.*foo.*` wrapping was a no-op that added backtracking work per doc.
        return {[(field.key || field)]: {$regex: Utils.escapeRegex(field.value.trim()), $options: 'i'}}
      }
    })} : false;
    let filtersValue = hasSearch ? {$or: data.filters.map((field)=>{
      const drop = (field.type && field.type !== 'text') || (hasAdvancedFilter && _.some(filters, (filter)=>{
        return field.key === filter.key && filter.value
      }));
      return !drop ? {[(field.key || field)]: {$regex: Utils.escapeRegex(search.get().trim()), $options: 'i'}} : false
    }).filter((field)=>{ return field; })} : false;
    if(advValue && filtersValue && filtersValue.$or && filtersValue.$or.length){
      selector = selector ? {$and: [selector, filtersValue, advValue]} : {$and: [filtersValue, advValue]}
    }else if(advValue){
      selector = selector ? {$and: [selector, advValue]} : advValue
    }else{
      selector = selector ? {$and: [selector, filtersValue]} : filtersValue
    }
  }
  const sorting = (sort && {[sort]: (order ? +order : 1)})
    || (data.options && data.options.sort) || null;
  const page = template.page && template.page.get() || data.options && data.options.page || 0;
  const size = template.size && template.size.get() || data.options && data.options.size || 10;
  const fields = data.options && data.options.fields || null;

  // Session serializes via EJSON internally; storing the object directly avoids
  // a redundant JSON.stringify on every fetch.
  Session.set('ReactiveTableServerSideParams' + data.method, { selector, sorting, page, size, fields });

  // Drop responses from stale concurrent requests so out-of-order results
  // can't show the wrong page.
  const requestId = ++template.requestSeq;
  Meteor.callAsync(data.method, selector, sorting, page, size, fields).then(function(result) {
    if (requestId !== template.requestSeq) return;
    template.list.set((result && result.list) || []);
    template.meta.set((result && result.meta) || null);
    template.error.set(null);
  }).catch(function(error) {
    if (requestId !== template.requestSeq) return;
    const text = error.message || error.reason || error.toString();
    template.list.set([]);
    template.meta.set(null);
    template.error.set(text);
    Notify.danger(text);
  }).finally(function() {
    if (requestId !== template.requestSeq) return;
    template.loading.set(false);
  });
}

Template.reactiveTableServerSide.onCreated(function () {
  const template = this;
  const initialData = Template.currentData();

  // Per-instance ids - multiple tables on the same page would otherwise collide
  // on the modal's data-target / form id.
  this.instanceId = _.uniqueId('rtss_');
  this.modalId = 'filterOptions_' + this.instanceId;
  this.formId = 'filterOptionsForm_' + this.instanceId;

  this.requestSeq = 0;
  this.loading = new ReactiveVar(false);
  this.search = new ReactiveVar('');
  this.sort = new ReactiveVar();
  this.filters = new ReactiveVar();
  this.order = new ReactiveVar();
  this.page = new ReactiveVar(0);
  this.size = new ReactiveVar(initialData && initialData.options && initialData.options.size || 10);
  this.list = new ReactiveVar([]);
  this.meta = new ReactiveVar(null);
  this.error = new ReactiveVar(null);
  this.lastData = initialData;
  this.lastConfigSig = '';
  this.minSearchLength = (initialData && initialData.options && initialData.options.minSearchLength) || 3;

  // Per-instance debounced search. Defined here (not at module load) so the
  // deferred call can capture the template synchronously - `Template.instance()`
  // returns null inside async callbacks.
  this.debouncedSearch = _.debounce(function (val) {
    const trimmed = (val || '').trim();
    // Below threshold: regex over the whole company is too expensive for 1-2
    // chars. Clear any active filter so results aren't stale relative to the
    // visible input, then no-op until the user reaches the threshold.
    if (trimmed.length > 0 && trimmed.length < template.minSearchLength) {
      if (template.search.get() !== '') {
        template.search.set('');
        template.page.set(0);
        getTableData(template.lastData, template);
      }
      return;
    }
    if (template.search.get() === trimmed) return;
    template.search.set(trimmed);
    template.page.set(0);
    getTableData(template.lastData, template);
  }, 300);

  // Refetch when the parent passes a meaningfully different data context.
  // Compares method/selector/sort/filterKeys to skip the no-op reruns Blaze
  // produces when the parent re-renders with the same logical config.
  this.autorun(function () {
    const data = Template.currentData();
    if (!data) return;
    template.lastData = data;
    // On a cold page load (deep link or refresh) the DDP login handshake is still in
    // flight when the template is created. Calling a method at that point arrives with
    // no userId and the server auth gate refuses it with "401 Authentication required",
    // which this table then renders as a hard error - the data never loads even though
    // the user is signed in. Both Meteor.loggingIn() and Meteor.userId() are reactive,
    // so this autorun re-runs and fetches as soon as the session resolves.
    if (Meteor.loggingIn() || !Meteor.userId()) {
      template.loading.set(true);
      return;
    }
    const sig = JSON.stringify({
      m: data.method,
      s: data.options && data.options.selector,
      o: data.options && data.options.sort,
      f: (data.filters || []).map(function (f) { return f.key || f; })
    });
    if (sig === template.lastConfigSig) return;
    template.lastConfigSig = sig;
    Tracker.nonreactive(function () {
      getTableData(data, template);
    });
  });
});

Template.reactiveTableServerSide.onRendered(function () {
  const template = this;
  const data = template.lastData;
  const $form = template.$('#' + template.formId);
  if (!$form.length) return;
  const rules = {};
  _.forEach(data && data.filters, function (filter) {
    rules[filter.key] = { required: false };
  });
  $form.validate({
    rules,
    errorElement: 'span',
    errorPlacement: function (error, element) {
      $(element)
        .closest('form')
        .find('label[for="' + element.attr('id') + '"]')
        .append(error);
    },
    submitHandler: function (form) {
      const $f = $(form);
      const d = template.lastData;
      let fields = _.map(d.filters, function (filter) {
        // Selector matches both <input> and <select>.
        const value = $f.find(`[name=${filter.key}]`).val();
        return Object.assign({}, filter, { value });
      });
      fields = fields.filter(function (field) {
        return field.value && field.value.length;
      });
      template.filters.set(fields);
      getTableData(d, template);
      Meteor.setTimeout(function () {
        if (template.view.isDestroyed) return;
        template.$('#' + template.modalId).modal('hide');
      }, 100);
    }
  });

  // Bind the Clear button directly. Blaze event delegation should pick it up
  // too, but routing the click through jquery-validate / Bootstrap modal can
  // sometimes swallow it - direct binding is the reliable path.
  $form.off('click.rtssClear').on('click.rtssClear', '.modal-clear-filters', function (event) {
    event.preventDefault();
    const d = template.lastData;
    _.forEach(d.filters, function (filter) {
      const $el = $form.find(`[name=${filter.key}]`);
      if (filter.type === 'select') {
        const el = $el[0];
        if (el && el.tagName === 'SELECT') el.selectedIndex = 0;
      }
      $el.val('');
    });
    template.filters.set(null);
    getTableData(d, template);
  });
});

Template.reactiveTableServerSide.onDestroyed(function () {
  // Bump seq so any in-flight responses are dropped.
  this.requestSeq++;
  // Clear the leaked Session key so it doesn't persist across navigation.
  if (this.lastData && this.lastData.method) {
    Session.set('ReactiveTableServerSideParams' + this.lastData.method, undefined);
  }
  // Tear down the direct-bound modal handlers from onRendered.
  if (this.formId) {
    this.$('#' + this.formId).off('.rtssClear');
  }
});

Template.reactiveTableServerSide.helpers({
  modalId: function () {
    return Template.instance().modalId;
  },
  formId: function () {
    return Template.instance().formId;
  },
  reactiveTableSettings: function () {
    const template = Template.instance();
    return {
      requestInProgress: template.loading.get(),
      error: template.error.get(),
      collection: template.list.get() || [],
      showFilter: false,
      showNavigationRowsPerPage: false,
      showRowCount: false,
      showColumnToggles: false,
      multiColumnSort: false,
      showNavigation: 'never',
      noDataTmpl: Template.reactiveTableServerSideNoData,
      currentPage: 0,
      rowsPerPage: 10000,
      fields: Template.currentData().fields
    };
  },
  availablePages: function () {
    const meta = Template.instance().meta.get();
    if (!meta || !meta.pages) return [];
    const current = meta.page + 1;
    const start = Math.max(1, current - 2);
    const end = Math.min(meta.pages, current + 2);
    const arr = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  },
  currentPage: function () {
    const meta = Template.instance().meta.get();
    return meta && meta.page + 1;
  },
  isCurrent: function () {
    const meta = Template.instance().meta.get();
    const page = meta && meta.page + 1;
    return (page == this) ? 'active' : '';
  },
  hasPrev: function () {
    const meta = Template.instance().meta.get();
    return (meta && meta.page + 1 > 1) ? 'page-prev' : 'disabled';
  },
  hasFirst: function () {
    const meta = Template.instance().meta.get();
    return (meta && meta.page + 1 > 1) ? 'page-first' : 'disabled';
  },
  hasLast: function () {
    const meta = Template.instance().meta.get();
    return (meta && meta.page + 1 < meta.pages) ? 'page-last' : 'disabled';
  },
  hasNext: function () {
    const meta = Template.instance().meta.get();
    return (meta && meta.page + 1 < meta.pages) ? 'page-next' : 'disabled';
  },
  isCurrentSize: function () {
    const meta = Template.instance().meta.get();
    return (meta && meta.size == this) ? 'active' : '';
  },
  pageSizeOrTotal: function () {
    const template = Template.instance();
    const meta = template.meta.get();
    const list = template.list.get();
    const size = meta && meta.size;
    if (list) {
      return (list.length == size) ? size : list.length;
    }
  },
  getPluralized: function (text, list) {
    return list ? Pluralize(text, list.length || list, true) : '';
  },
  pages: function () {
    const meta = Template.instance().meta.get();
    return meta && meta.pages;
  },
  loading: function () {
    return Template.instance().loading.get();
  },
  filters: function () {
    const data = Template.currentData();
    const filtersValues = Template.instance().filters.get();
    // O(n) lookup instead of an O(n^2) _.find per item.
    const valueByKey = filtersValues ? new Map(filtersValues.map(function (v) { return [v.key, v.value]; })) : null;
    // Return new objects so the parent's data array isn't mutated.
    return (data.filters || []).map(function (item) {
      const value = valueByKey && valueByKey.has(item.key) ? valueByKey.get(item.key) : null;
      const isSelect = item.type === 'select';
      const out = Object.assign({}, item, { value, isSelect });
      if (isSelect) {
        // Normalize to {optionValue, label, isSelected}. Accept either
        // {key,label} (e.g. logEventsTypes) or {value,label} option shapes.
        // `allSelected` drives the leading "All" option's selected attr so
        // Blaze (not imperative DOM code) owns the cleared state.
        out.allSelected = value === null || value === undefined || value === '';
        out.options = (item.options || []).map(function (opt) {
          const ov = opt.value !== undefined ? opt.value : opt.key;
          return { optionValue: ov, label: opt.label, isSelected: ov === value };
        });
      }
      return out;
    });
  },
  total: function () {
    const meta = Template.instance().meta.get();
    return meta && meta.items;
  },
  sizeList: function () {
    return [5, 10, 15, 50];
  },
  size: function () {
    const meta = Template.instance().meta.get();
    return meta && meta.size;
  },
  hasPrevCompact: function () {
    const meta = Template.instance().meta.get();
    return meta && (meta.page + 1) > 1;
  },
  hasNextCompact: function () {
    const meta = Template.instance().meta.get();
    return meta && (meta.page + 1) < meta.pages;
  },
  hasFilter: function () {
    const data = Template.currentData();
    return data && data.filters && data.filters.length;
  },
  hasSorting: function () {
    const data = Template.currentData();
    return data && data.sortings && data.sortings.length;
  },
  hasAdvanced: function () {
    const data = Template.currentData();
    return data && data.options && data.options.hasAdvanced;
  },
  activeFilters: function () {
    const filtersValues = Template.instance().filters.get();
    return filtersValues && filtersValues.length;
  },
  availableSorting: function () {
    const data = Template.currentData();
    return (data.sortings || []).map(function (field) {
      return { key: field, label: fieldToLabel(field) };
    });
  },
  isCurrentSort: function (key) {
    const data = Template.parentData();
    const template = Template.instance();
    return key === (template.sort.get() || (data.options && data.options.sort &&
      Object.keys(data.options.sort)[0]));
  },
  isCurrentOrder: function (key) {
    const data = Template.currentData();
    const template = Template.instance();
    return key === (+template.order.get() || (data.options && data.options.sort &&
      Object.values(data.options.sort)[0]));
  }
});

function fieldToLabel(string){
  return Utils.capitalizeFirstLetter(string).replace(/([a-z])([A-Z])/g, '$1 $2')
}

Template.reactiveTableServerSide.events({
  'click .page-first': function (event) {
    event.preventDefault();
    const template = Template.instance();
    if (template.page.get() === 0) return;
    template.page.set(0);
    getTableData(template.lastData, template);
  },
  'click .page-last': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const meta = template.meta.get();
    if (!meta || template.page.get() === meta.pages - 1) return;
    template.page.set(meta.pages - 1);
    getTableData(template.lastData, template);
  },
  'click .page-prev': function (event) {
    event.preventDefault();
    const template = Template.instance();
    if (template.page.get() <= 0) return;
    template.page.set(template.page.get() - 1);
    getTableData(template.lastData, template);
  },
  'click .page-next': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const meta = template.meta.get();
    if (meta && template.page.get() >= meta.pages - 1) return;
    template.page.set((template.page.get() || 0) + 1);
    getTableData(template.lastData, template);
  },
  'click .toggle-page .page': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const targetPage = +$(event.target).attr('data-page') - 1;
    if (template.page.get() === targetPage) return;
    template.page.set(targetPage);
    getTableData(template.lastData, template);
  },
  'click .toggle-size .size': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const targetSize = +$(event.target).attr('data-size');
    if (!targetSize || template.size.get() === targetSize) return;
    template.size.set(targetSize);
    template.page.set(0);
    getTableData(template.lastData, template);
  },
  'click .toggle-order': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const val = template.order.get() === 1 ? -1 : 1;
    template.order.set(val);
    getTableData(template.lastData, template);
  },
  'change .sort-field': function (event) {
    event.preventDefault();
    const val = $(event.target).find(':selected').val();
    const template = Template.instance();
    if (template.sort.get() === val) return;
    template.sort.set(val);
    getTableData(template.lastData, template);
  },
  'input .search-field': function (event) {
    Template.instance().debouncedSearch($(event.target).val());
  },
  'click .compact-prev': function (event) {
    event.preventDefault();
    const template = Template.instance();
    if (template.page.get() <= 0) return;
    template.page.set(template.page.get() - 1);
    getTableData(template.lastData, template);
  },
  'click .compact-next': function (event) {
    event.preventDefault();
    const template = Template.instance();
    const meta = template.meta.get();
    if (meta && template.page.get() >= meta.pages - 1) return;
    template.page.set((template.page.get() || 0) + 1);
    getTableData(template.lastData, template);
  },
  'change .compact-page-input': function (event) {
    const template = Template.instance();
    const meta = template.meta.get();
    let val = parseInt($(event.target).val(), 10);
    if (isNaN(val) || val < 1) val = 1;
    if (meta && val > meta.pages) val = meta.pages;
    if (template.page.get() === val - 1) return;
    template.page.set(val - 1);
    getTableData(template.lastData, template);
  },
  'change .compact-size-input': function (event) {
    const template = Template.instance();
    let val = parseInt($(event.target).val(), 10);
    if (isNaN(val) || val < 1) val = 10;
    if (template.size.get() === val) return;
    template.size.set(val);
    template.page.set(0);
    getTableData(template.lastData, template);
  }
  // Note: Clear button click is bound directly in onRendered (see comment
  // above the binding). Blaze event delegation here was unreliable in this
  // modal context.
});

Template.reactiveTableServerSideNoData.helpers({
  requestInProgress: function () {
    let data = Template.parentData();
    return !data.settings || data.settings && data.settings.requestInProgress
  },
  hasError: function () {
    let data = Template.parentData();
    return !data.settings || data.settings && data.settings.error
  }
});

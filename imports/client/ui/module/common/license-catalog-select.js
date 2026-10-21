// The one license <select> in the module UI.
//
// Extracted verbatim from `rootComponentLicensePickerSelect` so the root
// component picker and the new unmatched-license resolution offer the SAME
// catalogue, sorted the same way, with the same select2 behaviour - two
// controls that drift apart is how a company ends up able to pick a license in
// one place that the other rejects.
//
// The control (and the PRIVATE LICENSES optgroup within it) works the same
// for every company - there is no account-tier gate here or on the root
// picker it is shared with, which the feature requires.
//
// Props (data context):
//   selectId          id for the <select>, so a <label for> can point at it
//   value             the currently selected key (reactive; drives the field)
//   includeEdgeCases  pin NO-LICENSE / PUBLIC-DOMAIN / UNKNOWN into their own
//                     first optgroup and drop them from "Standard licenses"
//   includeNoneOption render a leading "- none -" entry (clearing the pick)
//   disabled          disable the control while a save is in flight
//   onChange          optional callback(value); parents may equally rely on the
//                     native change event bubbling into their own event map
import {Template} from 'meteor/templating';
import {Tracker} from 'meteor/tracker';
import {ReactiveVar} from 'meteor/reactive-var';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import Licenses from '/imports/lib/collections/licenses';
import {
  CATCH_ALL_LICENSE_KEYS,
  isCatchAllLicenseKey
} from '/imports/lib/licenseResolution/catchAllLicenses';

const SELECT = '.license-catalog-select';

// One-line hints for the two-line dropdown rows. The long-form explanations
// below the field live in EDGE_CASE_EXPLANATIONS; both are UI copy, while the
// KEY LIST itself is owned by imports/lib/licenseResolution/catchAllLicenses.js
// and must never be forked here.
// "rights holder" rather than "author" throughout: an author may have assigned
// the rights away, and it is the holder who can grant or waive them.
const EDGE_CASE_HINTS = {
  'NO-LICENSE': 'No rights granted by the rights holder.',
  'PUBLIC-DOMAIN': 'Explicitly placed in the public domain.',
  'UNKNOWN': 'Investigated, but still not determinable.'
};

const EDGE_CASE_EXPLANATIONS = {
  'NO-LICENSE': 'Pick this only when you have checked the sources and there genuinely is no license text - ' +
    'the rights holder granted no rights at all. If you looked and still cannot tell, pick "UNKNOWN" instead.',
  // Deliberately steers a named dedication BACK to its own identifier: CC0-1.0
  // and Unlicense are catalogue entries in this very select, and recording
  // PUBLIC-DOMAIN instead would erase the precise SPDX identifier from the
  // component's SBOM and Notice output for good.
  'PUBLIC-DOMAIN': 'Pick this only when the rights holder explicitly waived all rights and the list has no ' +
    'entry for the dedication used - for example a written "placed in the public domain" notice. ' +
    'If the dedication is a named license such as CC0-1.0 or the Unlicense, pick that instead.',
  // No verdict word here: whether UNKNOWN comes back as a warning is decided by
  // the ts-analysis worker (risk R1), not by this app.
  'UNKNOWN': 'Pick this when you investigated and still cannot tell. This is an honest audit record, not a ' +
    'clean result - it does not clear the component.'
};

function hintFor(key) {
  return Object.prototype.hasOwnProperty.call(EDGE_CASE_HINTS, key) ? EDGE_CASE_HINTS[key] : '';
}

function privateLicenses() {
  const company = Session.get('company');
  return (company && company.privateLicenses) || [];
}

// Two-line dropdown row: bold key, then a muted explanation. Built as DOM nodes
// with textContent rather than an HTML string - private license keys and
// catalogue names are not ours to trust with innerHTML.
function renderOption(state) {
  if (!state || !state.id) return state ? state.text : '';
  const wrapper = document.createElement('span');
  wrapper.className = 'license-catalog-option';
  const title = document.createElement('strong');
  title.textContent = state.id;
  wrapper.appendChild(title);
  const hint = state.element && state.element.getAttribute('data-hint');
  if (hint) {
    const line = document.createElement('span');
    line.className = 'license-catalog-option-hint';
    line.textContent = hint;
    wrapper.appendChild(line);
  }
  return $(wrapper);
}

// Only the key in the closed field: the aside is ~300-400px wide and
// "MIT - MIT License" truncates to nothing useful.
function renderSelection(state) {
  if (!state) return '';
  return state.id || state.text || '';
}

Template.licenseCatalogSelect.onCreated(function () {
  this.subscribe('licenses', true);
  // Drives the long-form explanation under the field. Seeded from `value` and
  // updated live on change, so the explanation appears while the user is still
  // deciding - not only after a save.
  this.currentKey = new ReactiveVar('');
  const instance = this;
  this.autorun(function () {
    const data = Template.currentData();
    instance.currentKey.set((data && data.value) || '');
  });
});

Template.licenseCatalogSelect.onRendered(function () {
  const instance = this;
  let lastSignature = null;
  // The last value pushed INTO select2, so a silent DOM change cannot be
  // mistaken for "already in sync". See the guard below.
  let lastValue = null;
  instance.autorun(function () {
    const data = Template.currentData() || {};
    // Reactive on the option list (Licenses + private) and on the value.
    const optionsSignature = Licenses.find({}, {fields: {_id: 1}}).count() + ':' +
      privateLicenses().length + ':' + (data.includeEdgeCases ? 1 : 0) + ':' +
      (instance.subscriptionsReady() ? 1 : 0);
    const value = data.value || '';
    const disabled = !!data.disabled;
    Tracker.afterFlush(function () {
      const node = instance.find && instance.find(SELECT);
      if (!node) return;
      const $select = $(node);
      // Re-init whenever the option list changed, so select2 picks up the
      // <option> nodes Spacebars has just added.
      if (optionsSignature !== lastSignature) {
        if ($select.data('select2')) $select.select2('destroy');
        $select.select2({
          width: '100%',
          dropdownAutoWidth: true,
          // The aside sits flush against the 48px right bar; without a capped,
          // wrapping dropdown the two-line rows run off the viewport.
          dropdownCssClass: 'license-catalog-dropdown',
          placeholder: 'Choose a license…',
          allowClear: false,
          templateResult: renderOption,
          templateSelection: renderSelection
        });
        lastSignature = optionsSignature;
        lastValue = null;
      }
      // Kept for onDestroyed: instance.find() returns null once Blaze has
      // detached the nodes, and select2's sibling container is not a Blaze node,
      // so without these two references the widget is orphaned on teardown.
      instance._selectNode = node;
      instance._select2Container = node.nextElementSibling &&
        node.nextElementSibling.classList.contains('select2-container') ?
        node.nextElementSibling : instance._select2Container;
      // Compare against the value WE last pushed, not against the DOM's current
      // one. Spacebars re-renders each option's `selected={{isCurrent key}}`, so
      // when the consumer clears the value Blaze can silently reset the native
      // select to '' on its own - and a `$select.val() !== value` guard then sees
      // nothing to do and never tells select2. The widget keeps displaying the
      // abandoned license while the control holds nothing, which is exactly what
      // the reset-on-cancel path looked like: value "", picker still saying MIT.
      if (lastValue !== value || ($select.val() || '') !== value) {
        $select.val(value).trigger('change.select2');
        lastValue = value;
      }
      // The `action-in-progress` overlay does not cover a body-appended select2
      // dropdown, so the underlying control has to be disabled as well.
      if ($select.prop('disabled') !== disabled) {
        $select.prop('disabled', disabled).trigger('change.select2');
      }
    });
  });
});

// select2 appends its own `.select2-container` as a SIBLING of the <select>.
// That span is not a Blaze node, so when this template is torn down - which is
// exactly what happens the moment a resolution is saved and the section swaps to
// its resolved branch - Blaze removes the <select> it created and leaves the
// container behind, still showing the last picked license. The result is the
// license rendered twice: once by the orphan, once by the resolved panel.
//
// `this.find()` cannot fix it: by the time onDestroyed runs the instance's nodes
// are already detached, so it returns null and the guard below used to skip
// silently. The node captured during onRendered is kept instead, and any stray
// container is removed directly as a backstop.
Template.licenseCatalogSelect.onDestroyed(function () {
  const node = this._selectNode || (this.find && this.find(SELECT));
  const $select = node && $(node);
  if ($select && $select.data && $select.data('select2')) {
    $select.select2('destroy');
  }
  const container = this._select2Container;
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  this._selectNode = null;
  this._select2Container = null;
});

// The props handed down by the consumer. Read off the TEMPLATE INSTANCE, never
// via Template.currentData(): inside the {{#each}} option loops currentData() is
// the option row, so `isCurrent` would compare `value` against an object that
// has never carried one and silently never match.
function props() {
  return Template.instance().data || {};
}

Template.licenseCatalogSelect.helpers({
  catalogueLoading: function () {
    return !Template.instance().subscriptionsReady();
  },

  catalogueEmpty: function () {
    const instance = Template.instance();
    if (!instance.subscriptionsReady()) return false;
    return Licenses.find({}, {fields: {_id: 1}}).count() === 0 && privateLicenses().length === 0;
  },

  disabledAttr: function () {
    // Blaze rejects {{#if}} in bare attribute position; a helper returning the
    // attribute NAME (or '') is the supported way to emit a boolean attribute.
    return (props().disabled || !Template.instance().subscriptionsReady()) ? 'disabled' : '';
  },

  showEdgeCases: function () {
    return !!props().includeEdgeCases;
  },

  edgeCaseOptions: function () {
    // Catalogue rows only: a key the catalogue does not carry cannot be saved,
    // so offering it would be a dead end.
    return CATCH_ALL_LICENSE_KEYS.map(function (key) {
      const doc = Licenses.findOne({key: key}, {fields: {key: 1, name: 1}});
      return doc ? {key: key, hint: hintFor(key)} : null;
    }).filter(Boolean);
  },

  edgeCaseExplanation: function () {
    if (!props().includeEdgeCases) return '';
    const key = Template.instance().currentKey.get();
    return Object.prototype.hasOwnProperty.call(EDGE_CASE_EXPLANATIONS, key) ?
      EDGE_CASE_EXPLANATIONS[key] : '';
  },

  hasPrivateLicenses: function () {
    return privateLicenses().length > 0;
  },

  privateLicenseOptions: function () {
    return privateLicenses();
  },

  publicLicenseOptions: function () {
    const list = Licenses.find({}, {sort: {key: 1}, fields: {key: 1, name: 1}}).fetch();
    // Only drop the catch-all keys when they are pinned above; otherwise they
    // would disappear from the catalogue entirely.
    if (!props().includeEdgeCases) return list;
    return list.filter(function (item) {
      return !isCatchAllLicenseKey(item.key);
    });
  },

  isCurrent: function (key) {
    return props().value === key;
  }
});

Template.licenseCatalogSelect.events({
  'change .license-catalog-select': function (event, instance) {
    const value = event.target.value || '';
    instance.currentKey.set(value);
    const data = instance.data;
    if (data && typeof data.onChange === 'function') {
      data.onChange(value);
    }
    // The native event keeps bubbling: parents may equally handle it in their
    // own Blaze event map (that is how rootComponentLicensePicker saves).
  }
});

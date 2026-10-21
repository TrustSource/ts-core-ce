import {Template} from 'meteor/templating';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';

/**
 * used Session variable: 'this.sessionVar' = {
 *      ok:         if true all objects with state 'ok' are filtered, i.e ok box is not checked
 *      warnings: if true all objects with state 'warnings' are filtered, i.e warnings box is not checked
 *      violations: if true all objects with state 'violations' are filtered, i.e violations box is not checked
 * }
 *
 */

function getParentInstance(levels) {
  let view = Blaze.currentView;
  while (view && levels > 0) {
    view = view.parentView;
    if (view && view.name && view.name.startsWith('Template.') && view.templateInstance) {
      levels--;
    }
  }
  return view && view.templateInstance && view.templateInstance();
}

function isFiltered(sessionVar, name) {
  const filter = Session.get(sessionVar);
  return filter && filter[name] === true;
}

function setFilter(sessionVar, name, active) {
  const filter = Session.get(sessionVar) || {};
  filter[name] = active;
  Session.set(sessionVar, filter);
  const parent = getParentInstance(1);
  if (parent && parent.currentPage) parent.currentPage.set(0);
}

Template.approvesStateFilter.events({
  'change .showOks': function (event) {
    setFilter(this.sessionVar, 'approved', !event.target.checked);
  },
  'change .showWarnings': function (event) {
    setFilter(this.sessionVar, 'open', !event.target.checked);
  },
  'change .showViolations': function (event) {
    setFilter(this.sessionVar, 'rejected', !event.target.checked);
  },
  'change .showDrafts': function (event) {
    setFilter(this.sessionVar, 'draft', !event.target.checked);
  },
  'change .view_type': function (event) {
    Session.set('approvesViewType', $(event.target).find(':selected').val());
    const parent = getParentInstance(1);
    if (parent && parent.currentPage) parent.currentPage.set(0);
  }
});

Template.approvesStateFilter.helpers({
  activeTab: function (func) {
    return func ? 'active-tab' : '';
  },

  activeList: function (func) {
    return func ? 'active' : '';
  },

  optionClass: function () {
    return this.optionClass;
  },

  isActiveType: function (view) {
    const viewType = Session.get('approvesViewType') || ''
    return viewType === view
  },


  showOks: function () {
    return !isFiltered(this.sessionVar, 'approved');
  },

  showWarnings: function () {
    return !isFiltered(this.sessionVar, 'open');
  },

  showViolations: function () {
    return !isFiltered(this.sessionVar, 'rejected');
  },

  showDrafts: function () {
    return !isFiltered(this.sessionVar, 'draft');
  }
});

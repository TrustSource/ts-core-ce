import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';

/**
 * used Session variable: 'this.sessionVar' = {
 *      ok:         if true all objects with state 'ok' are filtered, i.e ok box is not checked
 *      warnings: if true all objects with state 'warnings' are filtered, i.e warnings box is not checked
 *      violations: if true all objects with state 'violations' are filtered, i.e violations box is not checked
 * }
 *
 */

function isFiltered(sessionVar, name) {
  const filter = Session.get(sessionVar);
  return filter && filter[name] === true;
}

function setFilter(sessionVar, name, active) {
  const filter = Session.get(sessionVar) || {};
  filter[name] = active;
  Session.set(sessionVar, filter);
  Session.set('pageListNumber',1);
}

Template.stateFilter.events({
  'change .showOks': function (event) {
    setFilter(this.sessionVar, 'ok', !event.target.checked);
  },
  'change .showWarnings': function (event) {
    setFilter(this.sessionVar, 'warnings', !event.target.checked);
  },
  'change .showViolations': function (event) {
    setFilter(this.sessionVar, 'violations', !event.target.checked);
  }
});

Template.stateFilter.helpers({
  activeTab: function (func) {
    return func ? 'active-tab' : '';
  },

  activeList: function (func) {
    return func ? 'active' : '';
  },

  optionClass: function () {
    return this.optionClass;
  },

  showOks: function () {
    return !isFiltered(this.sessionVar, 'ok');
  },

  showWarnings: function () {
    return !isFiltered(this.sessionVar, 'warnings');
  },

  showViolations: function () {
    return !isFiltered(this.sessionVar, 'violations');
  }
});

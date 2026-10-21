import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';

function isFiltered(sessionVar, name) {
  const filter = Session.get(sessionVar);
  return filter && filter[name] === true;
}

function setFilter(sessionVar, name, active) {
  const filter = Session.get(sessionVar) || {};
  filter[name] = active;
  Session.set(sessionVar, filter);
}

Template.csafStateFilter.events({
  'change .showOks': function (event) {
    setFilter(this.sessionVar, 'PUBLISHED', !event.target.checked);
  },
  'change .showWarnings': function (event) {
    setFilter(this.sessionVar, 'DRAFT', !event.target.checked);
  },
  'change .showDangers': function (event) {
    setFilter(this.sessionVar, 'FAILED', !event.target.checked);
  }
});

Template.csafStateFilter.helpers({
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
    return !isFiltered(this.sessionVar, 'PUBLISHED');
  },

  showWarnings: function () {
    return !isFiltered(this.sessionVar, 'DRAFT');
  },

  showDangers: function () {
    return !isFiltered(this.sessionVar, 'FAILED');
  }
});

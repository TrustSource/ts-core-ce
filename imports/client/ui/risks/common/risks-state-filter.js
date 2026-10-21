import {Template} from 'meteor/templating';
import {Blaze} from 'meteor/blaze';
import {Session} from 'meteor/session';

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

Template.risksStateFilter.events({
  'change .showOks': function (event) {
    setFilter(this.sessionVar, 'resolved', !event.target.checked);
  },
  'change .showWarnings': function (event) {
    setFilter(this.sessionVar, 'unidentified', !event.target.checked);
  },
  'change .showDrafts': function (event) {
    setFilter(this.sessionVar, 'opened', !event.target.checked);
  }
});

Template.risksStateFilter.helpers({
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
    return !isFiltered(this.sessionVar, 'resolved');
  },

  showWarnings: function () {
    return !isFiltered(this.sessionVar, 'unidentified');
  },

  showDrafts: function () {
    return !isFiltered(this.sessionVar, 'opened');
  }
});

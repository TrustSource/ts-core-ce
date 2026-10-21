// Reactive localStorage wrapper - local fork for Meteor 3
// Original: simply:reactive-local-storage
import { Tracker } from 'meteor/tracker';
import { EJSON } from 'meteor/ejson';

const ReactiveLocalStorage = {
  _deps: {},

  _ensureDep: function(key) {
    if (!this._deps[key]) {
      this._deps[key] = new Tracker.Dependency();
    }
    return this._deps[key];
  },

  setItem: function(key, value) {
    localStorage.setItem(key, EJSON.stringify(value));
    this._ensureDep(key).changed();
  },

  getItem: function(key) {
    this._ensureDep(key).depend();
    var raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return EJSON.parse(raw);
    } catch(e) {
      return raw;
    }
  },

  removeItem: function(key) {
    localStorage.removeItem(key);
    this._ensureDep(key).changed();
  },

  clear: function() {
    localStorage.clear();
    Object.keys(this._deps).forEach(function(key) {
      this._deps[key].changed();
    }.bind(this));
  }
};

export default ReactiveLocalStorage;

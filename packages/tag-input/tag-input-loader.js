// stricker:tag-input — local reimplementation for Meteor 3
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { $ } from 'meteor/jquery';

import './tag-input.html';

Template.tagInput.onCreated(function () {
  var data = this.data || {};
  this._tags = new ReactiveVar(data.tags || []);
});

Template.tagInput.helpers({
  tags: function () {
    var inst = Template.instance();
    return inst && inst._tags && inst._tags.get() || [];
  },
  placeholder: function () {
    return Template.currentData().placeholder || '';
  },
  name: function () {
    return Template.currentData().name || 'tags';
  },
  hiddenValue: function () {
    var inst = Template.instance();
    var tags = inst && inst._tags && inst._tags.get() || [];
    return tags.join(',');
  }
});

Template.tagInput.events({
  'keydown .tag-input-field': function (e, tmpl) {
    if (e.which === 13 || e.which === 188) {
      e.preventDefault();
      var val = $(e.target).val().trim();
      if (!val) return;
      var data = Template.currentData() || {};
      var tags = tmpl._tags.get().slice();
      if (!data.allowDuplicates && tags.indexOf(val) !== -1) return;
      tags.push(val);
      tmpl._tags.set(tags);
      $(e.target).val('');
    }
    if (e.which === 8 && !$(e.target).val()) {
      var tags = tmpl._tags.get().slice();
      if (tags.length) {
        tags.pop();
        tmpl._tags.set(tags);
      }
    }
  },
  'click .tag-input-remove': function (e, tmpl) {
    e.preventDefault();
    var tag = $(e.currentTarget).data('tag');
    var tags = tmpl._tags.get().filter(function (t) { return t !== tag; });
    tmpl._tags.set(tags);
  }
});

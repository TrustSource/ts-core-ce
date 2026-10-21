import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {i18n} from 'meteor/universe:i18n';

// Filter box above a versions table.
//
// The term is owned by a ReactiveVar on the *calling* template's instance,
// handed over as `filter=`. Session was the obvious alternative and the wrong
// one: `pageListNumber`/`pageListSize` are already global keys shared by every
// list in the app, and a version filter that outlived the page would be a bug.
//
// Params:
//   filter           ReactiveVar holding the term (required)
//   matched          number of versions the term matches
//   total            number of versions before filtering
//   clearsSelection  true on the component-manager edit pages, where rows carry
//                    checkboxes and an inline edit state that must not survive
//                    the rows leaving the DOM

const TYPING_DEBOUNCE_MS = 150;

function applyTerm(instance, value) {
  const data = instance.data || {};
  if (data.filter) {
    data.filter.set(value);
  }
  // A term that narrows 400 versions to 3 leaves any page but the first out of
  // range, so paging always restarts with the filter.
  Session.set('pageListNumber', 1);

  if (!data.clearsSelection) {
    return;
  }
  // `selectedVersions` is rebuilt from the checkboxes currently in the DOM, so
  // a ticked row that the filter hides would stay selected and invisible - and
  // "Set to selected" would then write to versions the user can no longer see.
  //
  // The checkboxes are the parent's, not this template's, so instance.$ cannot
  // reach them: scope up to the enclosing versions panel instead.
  Session.set('selectedVersions', []);
  const panel = instance.$('.version-search').closest('.component-version');
  panel.find('.mark-selected-all').prop('checked', false);
  panel.find('input[name=versions]').prop('checked', false);
  // The inline edit key is 'version-<display index>', and filtering renumbers
  // the rows, so an open editor would reattach itself to a different version.
  Session.set('editField', '');
}

Template.versionSearch.onCreated(function () {
  this.typingTimer = null;
});

Template.versionSearch.onDestroyed(function () {
  if (this.typingTimer) {
    Meteor.clearTimeout(this.typingTimer);
    this.typingTimer = null;
  }
});

Template.versionSearch.helpers({
  term: function () {
    return this.filter && this.filter.get() || '';
  }
});

// The count sits in the badge beside the "Versions" title, not under the box:
// while a filter is active it reads "2 of 4 versions" in place of the bare
// total. Its own template so all eight pages get it from one include.
Template.versionCount.helpers({
  countText: function () {
    const term = this.filter && this.filter.get();
    if (!term || !term.trim()) {
      return this.total || 0;
    }
    return i18n.__('VersionsMatching', {
      matched: this.matched || 0,
      total: this.total || 0
    });
  }
});

Template.versionSearch.events({
  'input .version-search-input': function (event, instance) {
    const value = event.target.value;
    if (instance.typingTimer) {
      Meteor.clearTimeout(instance.typingTimer);
    }
    // Typing into a 400-version list would otherwise re-slice, re-sort and
    // re-render the table on every keystroke.
    instance.typingTimer = Meteor.setTimeout(function () {
      instance.typingTimer = null;
      applyTerm(instance, value);
    }, TYPING_DEBOUNCE_MS);
  },
  'click .version-search-clear': function (event, instance) {
    if (instance.typingTimer) {
      Meteor.clearTimeout(instance.typingTimer);
      instance.typingTimer = null;
    }
    // Blaze writes the `value` attribute, which a browser ignores once the user
    // has typed into the field, so the DOM has to be cleared by hand.
    const input = instance.$('.version-search-input');
    input.val('');
    applyTerm(instance, '');
    input.trigger('focus');
  }
});

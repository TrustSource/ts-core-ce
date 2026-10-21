import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';

// The catalog search of Add/link module (COTS or Infrastructure component). The
// input is wired to the typeahead plugin here: the template's data-source /
// data-select attributes were meant for sergeyt:typeahead's inject(), which the
// local fork of that package does not have, so the field never suggested anything.
function searchComponents(query, sync, callback) {
  Meteor.callAsync('searchInfrastructureComponents', query).then(function(res) {
    callback(_.map(res, function (component) {
      component.value = component.name
      return component
    }));
  }).catch(function(err) {
    console.log(err);
    callback([]);
  });
}

function selectedComponent(e, suggestion) {
  Session.set('componentTypeaheadComponent', suggestion)
  Session.set('versionTypeaheadVersion', false)
}

Template.componentTypeahead.onRendered(function () {
  Session.set('componentTypeaheadComponent', false)
  const input = this.$('.typeahead');
  input.typeahead({hint: true, minLength: 1, highlight: true}, {
    name: 'components',
    displayKey: 'value',
    limit: 15,
    source: _.debounce(searchComponents, 150)
  });
  input.on('typeahead:selected', selectedComponent);
  // Typing after a selection means a different component.
  input.on('input', function () {
    if (Session.get('componentTypeaheadComponent')) {
      Session.set('componentTypeaheadComponent', false);
      Session.set('versionTypeaheadVersion', false);
    }
  });
});

Template.componentTypeahead.onDestroyed(function () {
  this.$('.typeahead').typeahead('destroy');
});

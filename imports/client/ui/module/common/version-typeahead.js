import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import _ from 'underscore';
import SemverExt from '/imports/lib/component/SemverExt';

// The versions of the catalog entry chosen in componentTypeahead, newest first, with
// their licenses. Wired to the typeahead plugin here (see component-typeahead.js).
function searchVersions(query, sync, callback) {
  const component = Session.get('componentTypeaheadComponent')
  if (!component) {
    callback([]);
    return;
  }
  let versions = _.filter(component.versions, function (version) {
    return !query || (version.version && version.version.toLowerCase().indexOf(query.toLowerCase()) > -1)
  })
  versions = _.map(SemverExt.arraySortByVersionDesc(versions), function (version) {
    const licenses = _.map(version.licenses, function (license) {
      return license.name
    }).join(', ')
    const licensesLine = licenses ? ' (' + licenses + ')' : ''
    return Object.assign({}, version, {
      licensesLine: licensesLine,
      value: version.version + licensesLine,
      id: version.version
    })
  })
  Meteor.setTimeout(function () {
    callback(versions)
  }, 10);
}

Template.versionTypeahead.onRendered(function () {
  Session.set('versionTypeaheadVersion', false)
  const input = this.$('.typeahead');
  // minLength 0: the versions show as soon as the field is focused.
  input.typeahead({hint: true, minLength: 0, highlight: true}, {
    name: 'versions',
    displayKey: 'value',
    limit: 50,
    source: searchVersions
  });
  input.on('typeahead:selected', function (e, suggestion) {
    Session.set('versionTypeaheadVersion', suggestion)
  });
  // A new component empties the version.
  this.autorun(() => {
    if (!Session.get('componentTypeaheadComponent')) {
      input.typeahead('val', '');
    }
  });
});

Template.versionTypeahead.onDestroyed(function () {
  this.$('.typeahead').typeahead('destroy');
});

Template.versionTypeahead.helpers({
  noSelectedComponent: function() {
    return Session.get('componentTypeaheadComponent') === false
  }
});

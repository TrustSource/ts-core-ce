import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Vulnerability from '/imports/lib/component/Vulnerability';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {matchVersions} from '/imports/client/ui/common/version-search/versionMatch';
import {pageSlice} from '/imports/client/ui/common/version-search/versionFilter';

// Sorted newest-first by the model, then narrowed by the filter box above the
// table. Both helpers below need the same list, so neither owns it.
function matchingVersions(component, instance) {
  return matchVersions(component.getVersions(true), instance.versionFilter.get());
}

Template.infrastructureComponentDetails.onCreated(function () {
  this.versionFilter = new ReactiveVar('');
});

Template.infrastructureComponentDetails.onRendered(function () {
  Session.set('pageListSize', 10);
});

Template.infrastructureComponentDetails.helpers({
  hasVuln: function () {
    const version = this;
    return Vulnerability.findAll(version.component.getKey(), version.getVersion()).length > 0;
  },

  getVuln: function () {
    const version = this;
    return Vulnerability.findAll(version.component.getKey(), version.getVersion());
  },
  getRef: function () {
    const vulnerability = this;
    return Router.url('vlCveByName', null, {query:{filter:  JSON.stringify({cve: vulnerability.getName()})}});
  },
  companyId: function () {
    const user = Meteor.user();
    return user && user.profile && user.profile.companyId
  },
  versionFilter: function () {
    return Template.instance().versionFilter;
  },
  // Everything the filter matches. The pager counts pages over this rather than
  // over every version, or it would keep offering page 12 of a 3-row result.
  getVersionsMatching: function () {
    return matchingVersions(this, Template.instance());
  },
  getVersionsFiltered: function () {
    return pageSlice(matchingVersions(this, Template.instance()));
  }
});

import {Meteor} from 'meteor/meteor';
import {Session} from 'meteor/session';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {$} from 'meteor/jquery';
import _ from 'underscore';

Template.licenseDetail.onRendered(function () {
  const router = Router.current();
  if (router.params.query.filter) {
    Session.set('licenseListFilter', router.params.query.filter);
  }
});

Template.licenseDetail.onDestroyed(() => {
  Session.set('licenseListFilter');
});

Template.licenseDetail.events({
  'keyup input[name="search"]': _.throttle(evt => {
    let text = $(evt.target).val().trim();
    Session.set('licenseListFilter', text);
    let params = Router.current().params;
    let newUrl = Router.current().route.path(
      {projectId: params.projectId, moduleId: params.moduleId, key: params.key},
      {query: {'filter': text}}
    );
    Router.go(newUrl);
  }, 400)
});

Template.licenseDetail.helpers({
  getName: function () {
    return this && this.name || '';
  },
  getText: function () {
    // Returned raw: the `highlight` template escapes what it is given (deliberately, so a
    // stored value cannot inject markup), so injecting <br/> here only produced a literal
    // "<br/>" on screen. Line breaks are rendered by `white-space: pre-wrap` on the panel.
    return this && this.text || '';
  },
  hasText: function () {
    return !!(this && this.text);
  },
  getUrl: function () {
    return this && this.url || '';
  },
  getKey: function () {
    return this && this.key || '';
  },
  companyId: function () {
    let user = Meteor.user();
    return user && user.profile && user.profile.companyId;
  },
  query: function () {
    return (Router.current().params.query || {}).filter || '';
  },

  hasCreatedOrUpdate: function () {
    return this.created || this.updated
  },

  getCreated: function () {
    return this.created
  }
});

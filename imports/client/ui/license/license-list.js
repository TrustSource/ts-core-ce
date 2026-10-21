import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import _ from 'underscore';
import {ReactiveMethod} from '/imports/lib/reactiveMethod';

Template.licenseList.onRendered(function () {
  document.body.classList.add('flex-fill-page');
  Session.set('licenseActiveTab', 'allLicenses');
  const router = Router.current();
  if (router.params.query.filter) {
    Session.set('licenseListFilter', router.params.query.filter);
  }

  this.autorun(function () {
    if (!Session.get('topLicenses')) {
      Meteor.callAsync('getTopLicenseList').then(function(data) {
        Session.set('topLicenses', data);
      });
    }
  });
});

Template.licenseList.onDestroyed(() => {
  document.body.classList.remove('flex-fill-page');
  Session.set('topLicenses');
  Session.set('licenseListFilter');
  Session.set('licenseActiveTab');
  Session.set('licensesTotal', 0);
  Session.set('licensesList', 0);
});

Template.licenseList.events({
  'keyup input[name="search"]': _.throttle(evt => {
    let text = $(evt.target).val().trim();
    let newUrl = Router.current().route.path({}, {query: {'filter': text, page: 1}});
    Router.go(newUrl);
    Session.set('licenseListFilter', text);
  }, 400),
  'shown.bs.tab #license-tabs': function (event) {
    Session.set('licenseActiveTab', $(event.target).attr('href').replace('#', ''));
  }
});

Template.licenseList.helpers({
  licensesCount: function () {
    return Session.get('licensesTotal');
  },
  collectionLength: function ()  {
    return {length: Session.get('licensesTotal')};
  },
  listLength: function ()  {
    return {length: Session.get('licensesList')};
  },
  showPagination: function () {
    return Session.get('licenseActiveTab') !== 'topLicenseList';
  }
});

Template.licenses.helpers({
  isActiveTab: function (tab) {
    return tab === Session.get('licenseActiveTab');
  },

  getLicenses: function () {
    let getList = null;
    const filter = Session.get('licenseListFilter');
    Session.set('requestInProgress', true);
    if (Session.get('licenseActiveTab') === 'topLicenseList') {
      const topLicenses = Session.get('topLicenses');
      if (topLicenses && topLicenses instanceof Array) {
        getList = ReactiveMethod.call('Licenses.search', filter,
          {topLicenses, page: Session.get('pageListNumber'), pageSize: Session.get('pageListSize')});
      }
    } else {
      getList = ReactiveMethod.call('Licenses.search', filter,
        {page: Session.get('pageListNumber'), pageSize: Session.get('pageListSize')});
    }
    if (getList) {
      Session.set('requestInProgress', false);
      Session.set('licensesTotal', getList.total);
      Session.set('licensesList', getList.list);
      return getList.licenses;
    } else {
      return [];
    }
  },

  requestInProgress: function () {
    return Session.get('requestInProgress');
  }
});

Template.license.events({
  'click .license-row': function (event) {
    if ($(event.target).closest('a').length) return;
    const href = $(event.currentTarget).data('href');
    if (href) {
      Router.go(href);
    }
  }
});

Template.license.helpers({
  query: function () {
    return Session.get('licenseListFilter');
  },
  licenseDetailQuery: function () {
    return Session.get('licenseListFilter') ? {filter: Session.get('licenseListFilter')} : {};
  }
});

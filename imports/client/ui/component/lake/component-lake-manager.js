import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import Utils from '/imports/lib/utils';
import {createSearchState} from '/imports/client/ui/common/async-search/asyncSearchState';

// Component manager search mode: the full component database with
// the wider criteria set, through the existing searchComponentsByFields method,
// unchanged. Reading it needs no role - each editing control on the page carries its
// own company_component_manager check.
//
// This form is deliberately NOT a reuse of componentListFilter. That template
// searches on every keystroke, which contradicts the submit-driven model here,
// and it is shared by the COTS, infrastructure, algorithms and component-selector
// pages - growing it for CM criteria would drag all four along.
//
// The criteria travel as the same `?filter=<json>` shape the rest of the app uses.

// The route that renders this template. /components opens the lake directly, so this
// is the components route itself; /components/search/manager redirects here. The guard
// and both navigations below read it from here - when they named the route separately,
// pointing /components at this template left the autorun disabled and sent every submit
// through the redirect, which dropped the query and made Search do nothing.
const LAKE_ROUTE = 'componentList';

const CRITERIA_FIELDS = ['name', 'key', 'language', 'removed'];
const SORT_FIELDS = ['name', 'key', 'language', 'description'];

function currentFilter() {
  const router = Router.current();
  const raw = router && router.params && router.params.query && router.params.query.filter;
  if (!raw) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  // The ?filter= value is user-editable in the address bar, so rebuild it from a
  // fixed whitelist of string criteria rather than forwarding whatever it holds.
  // searchComponentsByFields pushes `language` into its Mongo selector unwrapped
  // (components.js:220), so an operator object arriving on that key would reach
  // the query directly. Project rule: strip $-prefixed keys from user-supplied
  // objects before they reach a selector, and type-check anything used in one.
  const criteria = {};
  for (const field of CRITERIA_FIELDS) {
    const value = parsed[field];
    if (typeof value === 'string' && value.trim()) {
      criteria[field] = value.trim();
    }
  }
  return criteria;
}

// Sort state travels as its own `?sort=`/`?order=` query params rather than
// inside ?filter=, so it stays out of CRITERIA_FIELDS and never reaches
// queryFields - sort/order are not search criteria. Anything outside the
// whitelist is ignored, matching the same rule applied to currentFilter above.
function currentSorting() {
  const router = Router.current();
  const query = (router && router.params && router.params.query) || {};
  const sort = SORT_FIELDS.indexOf(query.sort) !== -1 ? query.sort : 'name';
  const order = (query.order === '1' || query.order === '-1') ? query.order : 1;
  return {sort: sort, order: order};
}

// Router.current() invalidates on every route change, including the one that
// navigates AWAY from here - and that invalidation lands before Blaze tears the
// instance down. Without this guard, leaving the page fires one last search.
function isActiveRoute() {
  const router = Router.current();
  return !!router && !!router.route && router.route.getName() === LAKE_ROUTE;
}

Template.componentLakeManager.onCreated(function () {
  const instance = this;
  instance.search = createSearchState();

  instance.autorun(function () {
    if (!isActiveRoute()) {
      return;
    }
    const filter = currentFilter();
    if (!filter) {
      instance.search.reset();
      return;
    }
    const sorting = currentSorting();
    instance.search.run(function () {
      return Meteor.callAsync('searchComponentsByFields', filter, sorting);
    });
  });
});

Template.componentLakeManager.onRendered(function () {
  document.body.classList.add('flex-fill-page');
});

Template.componentLakeManager.onDestroyed(function () {
  document.body.classList.remove('flex-fill-page');
  this.search.stop();
});

Template.componentLakeManager.events({
  'submit #componentLakeManagerForm': function (event, instance) {
    event.preventDefault();
    const criteria = {};
    for (const field of CRITERIA_FIELDS) {
      const value = (instance.$('[name="' + field + '"]').val() || '').trim();
      if (value) {
        criteria[field] = value;
      }
    }
    const filterString = JSON.stringify(criteria);
    const sortInput = instance.$('select[name="sort"]').val();
    const orderInput = instance.$('select[name="order"]').val();
    const sort = SORT_FIELDS.indexOf(sortInput) !== -1 ? sortInput : 'name';
    const order = (orderInput === '1' || orderInput === '-1') ? orderInput : '1';

    const router = Router.current();
    const currentRaw = router && router.params && router.params.query && router.params.query.filter;
    const currentSort = currentSorting();
    if (currentRaw === filterString && currentSort.sort === sort && String(currentSort.order) === order) {
      // Same URL means no autorun re-run; treat a repeat submit as "try again".
      instance.search.retry();
      return;
    }
    Router.go(LAKE_ROUTE, {}, {query: {filter: filterString, sort: sort, order: order}});
  },
  'click .component-lake-reset': function (event, instance) {
    event.preventDefault();
    instance.$('#componentLakeManagerForm')[0].reset();
    instance.$('select[name="sort"]').val('name');
    instance.$('select[name="order"]').val('1');
    Router.go(LAKE_ROUTE, {}, {query: {}});
  },
  'click .search-retry': function (event, instance) {
    event.preventDefault();
    instance.search.retry();
  }
});

Template.componentLakeManager.helpers({
  allowedLanguages: function () {
    return Utils.getAllowedLanguages;
  },
  criterion: function (field) {
    const filter = currentFilter();
    return (filter && filter[field]) || '';
  },
  isSelected: function (field, value) {
    const filter = currentFilter();
    return !!filter && filter[field] === value;
  },
  isSortedBy: function (field) {
    return currentSorting().sort === field;
  },
  isOrderedBy: function (value) {
    return String(currentSorting().order) === value;
  },
  isLoading: function () {
    return Template.instance().search.status() === 'loading';
  },
  isError: function () {
    return Template.instance().search.status() === 'error';
  },
  isReady: function () {
    return Template.instance().search.status() === 'ready';
  },
  searchPhase: function () {
    return Template.instance().search.phase();
  },
  searchError: function () {
    return Template.instance().search.error();
  },
  searchRows: function () {
    return Template.instance().search.rows();
  }
});

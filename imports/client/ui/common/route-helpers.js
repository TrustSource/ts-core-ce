/**
 * Custom replacements for zimme:active-route and monbro:iron-router-breadcrumb.
 * These packages depended on iron:router which conflicts with galvanized-iron-router.
 */
import {Template} from 'meteor/templating';
import {Router} from 'meteor/vlasky:galvanized-iron-router';

// --- isActiveRoute helper (replaces zimme:active-route) ---

Template.registerHelper('isActiveRoute', function (options) {
  const hash = options && options.hash ? options.hash : {};
  const regex = hash.regex || hash.name;
  if (!regex) return '';

  const route = Router.current() && Router.current().route;
  if (!route) return '';

  const routeName = route.getName();
  if (!routeName) return '';

  try {
    if (new RegExp(regex).test(routeName)) {
      return 'active';
    }
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (_e) { /* intentionally ignored */ }
  return '';
});

// --- breadcrumb template (replaces monbro:iron-router-breadcrumb) ---

import './route-helpers.html';

Template.breadcrumb.helpers({
  breadcrumbs() {
    const controller = Router.current();
    const route = controller && controller.route;
    if (!route) return [];

    const crumbs = [];
    let current = route;

    // Walk up the parent chain
    while (current) {
      const options = current.options || {};
      const name = current.getName();

      // title can be a string or a function(). Call functions with the
      // current controller so this.params etc. are available.
      let title;
      try {
        title = typeof options.title === 'function'
          ? options.title.call(controller)
          : (options.title || name || '');
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_e) {
        title = name || '';
      }

      // Pass current route params so parent breadcrumb URLs resolve correctly
      // (e.g. /projects/:projectId needs the projectId from the current route)
      let url = '#';
      try {
        if (Router.routes[name]) {
          url = Router.path(name, controller.params);
        }
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
      } catch (_e) { /* intentionally ignored */ }

      crumbs.unshift({
        title: title,
        url: url,
        isLast: crumbs.length === 0
      });

      const parentName = options.parent;
      if (parentName && Router.routes[parentName]) {
        current = Router.routes[parentName];
      } else {
        break;
      }
    }

    return crumbs;
  }
});

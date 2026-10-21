import {Template} from 'meteor/templating';
import {Meteor} from 'meteor/meteor';
import {$} from 'meteor/jquery';

Template.apiDocLatest.helpers({
  getUrlParams: () => {
    const user = Meteor.user();
    // emails[0].address is absent for users created by the former SSO/social
    // logins and before the user doc has loaded - fall back to the profile, then to empty (never the
    // literal string "undefined").
    const userEmail = (user && user.emails && user.emails[0] && user.emails[0].address) ||
      (user && user.profile && (user.profile.email || user.profile.login)) || '';

    const apiSpec = '/api-v2/openapi.yaml';
    const theme = (user && user.profile && user.profile.theme) || 'light';

    return `?user=${encodeURIComponent(userEmail)}&spec=${encodeURIComponent(apiSpec)}&theme=${theme}`;
  }
});

// The iframe-resizer jQuery plugin is no longer bundled; without it the frame keeps the
// height its stylesheet gives it, so only resize when the plugin is actually loaded.
Template.apiDocLatest.onRendered(() => {
  if (typeof $.fn.iFrameResize === 'function') {
    $('#swagger-ui').iFrameResize([{log: true}]);
  }
});

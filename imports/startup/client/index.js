/* global window:false */
import underscore from 'underscore';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { $ } from 'meteor/jquery';
import { Router } from 'meteor/vlasky:galvanized-iron-router';
import i18n from 'meteor/universe:i18n';
window._ = underscore;

// Translations are only rendered on the client; nothing on the server reads the
// per-connection locale. Left on, universe:i18n calls
// 'universe.i18n.setServerLocaleForConnection' on every (re)connect, which the DDP
// auth gate refuses before sign-in and logs as a console error on the login page.
i18n.setOptions({sameLocaleOnServerConnection: false});

Tracker.autorun(() => {
  const user = Meteor.user();

  if (user && user.profile && user.profile.lang) {
    i18n.setLocale(user.profile.lang);
  }else{
    i18n.setOptions({
      defaultLocale: 'en'
    });
  }
});

// Persistent subscriptions - kept outside Iron Router's waitOn so they are never
// stopped/restarted during route changes (prevents grey screen flash on navigation)
// The role subscriptions live in ./roles-ready so the router can share their
// readiness signal (see rolesReady / requireRole) without a circular import.
import '/imports/lib/roles-ready';
// Per-user client caches (Session.company / Session.modulesByProject): one reactive
// sync that drops and refills them whenever the signed-in user changes.
import './user-session';
Meteor.subscribe('projectsByCompany', true);
Meteor.subscribe('userData');
Meteor.subscribe('policyFiles');
Meteor.subscribe('constraints');
Meteor.subscribe('rules');
Meteor.subscribe('messagesLatest');
Meteor.subscribe('updatesLatest');
// Manually assigned CWEs. A handful of documents per company, read
// by three separate pages (test details, tests list, module tests), so it is
// simpler to hold it open than to remember it on every route that shows a
// weakness badge.
Meteor.subscribe('cweMappings');


// autoform 8.0.0 uses lazy-loaded templates - import static.js to eagerly
// register all autoForm/quickForm/afQuickField templates
import 'meteor/aldeed:autoform/static';

// AutoForm 8 no longer ships bootstrap3 theme templates inline.
// Load them from the communitypackages:autoform-bootstrap3 theme package.
import { AutoFormThemeBootstrap3 } from 'meteor/communitypackages:autoform-bootstrap3/static';
AutoFormThemeBootstrap3.load();

import { AutoForm } from 'meteor/aldeed:autoform';
AutoForm.setDefaultTemplate('bootstrap3');

// Meteor 3 fix: getComponentContext crashes when schema isn't available yet
// during initial Blaze render. Add null guard matching getSchemaForField pattern.
const _origGetComponentContext = AutoForm.Utility.getComponentContext;
AutoForm.Utility.getComponentContext = function (context, name) {
  const ss = AutoForm.getFormSchema();
  if (!ss) return;
  return _origGetComponentContext.call(this, context, name);
};

// Vendor jQuery plugins (were auto-loaded in Meteor 2, need explicit import in Meteor 3)
import '/client/vendor/iCheck/icheck.min.js';
import '/client/vendor/jquery-validation/jquery.validate.min.js';
import '/client/vendor/sparkline/index.js';

// Global fix: move modals to <body> on show so they escape any parent
// stacking context (sticky headers, z-indexed panels, etc.)
// NOTE: this detaches the modal from its Blaze template's DOM range, so
// Blaze event maps no longer fire inside a shown modal. Bind events for
// modal content directly on the modal element (delegated jQuery handlers
// in onRendered) instead of Template.xxx.events - see risk-add-modal.js.
// A modal parked on <body> whose original slot has gone belongs to a template Blaze has
// already torn down. Nothing will ever remove it: it is outside the view's DOM range, so
// it lingers with its ids intact and can shadow the live page's markup (a stale
// #createApproveForm sitting in front of the wizard's own form, for instance).
function pruneOrphanModals() {
  $('body > .modal').each(function () {
    if (this._modalHome && !this._modalHome.isConnected) {
      $(this).removeData('bs.modal');
      this.remove();
    }
  });
  if (!$('body > .modal.in').length) {
    $('.modal-backdrop').remove();
    document.body.classList.remove('modal-open');
  }
}

$(document).on('show.bs.modal', '.modal', function () {
  pruneOrphanModals();
  if (this.parentElement !== document.body) {
    // Remember where it came from so it can be handed back to Blaze on hide.
    this._modalHome = this.parentElement;
    document.body.appendChild(this);
  }
});

// Return the modal to its template once closed, so the normal Blaze teardown reclaims it;
// if the template is already gone (navigated away while the modal was open) drop it here.
$(document).on('hidden.bs.modal', '.modal', function () {
  const home = this._modalHome;
  this._modalHome = null;
  if (!home) return;
  // Blaze may have re-rendered the template while the modal sat on <body>, in which case a
  // fresh copy already fills the slot - drop this one instead of duplicating its ids.
  const alreadyReplaced = this.id && home.querySelector('#' + CSS.escape(this.id));
  if (!home.isConnected || alreadyReplaced) {
    $(this).removeData('bs.modal');
    this.remove();
    return;
  }
  home.appendChild(this);
});

// Navigating away with a modal open never fires hidden.bs.modal, so sweep after each route
// change - deferred so Blaze has finished tearing the previous template down.
Router.onStop(function () {
  Meteor.defer(pruneOrphanModals);
});

import '/imports/lib/router.js';
import '/imports/client/ui/layouts';
import '/imports/client/ui/common';
import '/imports/client/ui/account';
import '/imports/client/ui/component-manager';
import '/imports/client/ui/infrastucture-components';
import '/imports/client/ui/cots-components';
import '/imports/client/ui/component';
import '/imports/client/ui/dashboard';
import '/imports/client/ui/helpers';
import '/imports/client/ui/license';
import '/imports/client/ui/module';
import '/imports/client/ui/project';
import '/imports/client/ui/scan';
import '/imports/client/ui/reports';
import '/imports/client/ui/settings';
import '/imports/client/ui/module-import';
import '/imports/client/ui/scan-import';
import '/imports/client/ui/spdx-export';
import '/imports/client/ui/policy';
import '/imports/client/ui/messages';
import '/imports/client/ui/check';
import '/imports/client/ui/code-tests';
import '/imports/client/ui/approves';
import '/imports/client/ui/vulnerability-lake';
import '/imports/client/ui/scanners';
import '/imports/client/ui/releases';
import '/imports/client/ui/copyright-trademarks';
import '/imports/client/ui/api-doc-latest';
import '/imports/client/ui/verify';
import '/imports/client/ui/updates';
import '/imports/client/ui/csaf';
import '/imports/client/ui/products';
import '/imports/client/ui/risks';
import '/imports/client/ui/common/async-search';
import '/imports/client/ui/common/version-search';

// Register bootstrap3 aliases for custom input types that don't have themed variants.
// Without these, AutoForm 8.0.0 logs "no theme found" warnings for each custom type.
// Wrapped in Meteor.startup() to ensure all templates are registered first.
import { Template } from 'meteor/templating';
Meteor.startup(() => {
  Template['afSwitch_bootstrap3'] = Template['afSwitch'];
  Template['afEnumSwitch_bootstrap3'] = Template['afEnumSwitch'];
  Template['afSelect2_bootstrap3'] = Template['afSelect2'];
  Template['afNoUiSlider_bootstrap3'] = Template['afNoUiSlider'];
});

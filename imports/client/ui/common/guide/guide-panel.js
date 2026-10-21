/* global document:false, window:false */
// Guide side panel: the guidance for the screen that is open, as a list next to
// the page (like the chat panel in TrustSource). Clicking a step outlines its
// element; "Start tour" runs the same steps as a guided tour. The steps live in
// imports/lib/tour/guides.js.
import {Template} from 'meteor/templating';
import {Session} from 'meteor/session';
import {ReactiveVar} from 'meteor/reactive-var';
import {Tracker} from 'meteor/tracker';
import {Meteor} from 'meteor/meteor';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {Config} from '/imports/config';
import {getGuide, guideIdForRoute} from '/imports/lib/tour/guides';
import {startTour, endTourIfMovedAway, highlightElement, findGuideElement} from './tour';
// Imported here rather than only from index.js: the right bar and the screens
// import this module directly, and can load before index.js has registered the
// template.
import './guide-panel.html';

const OPEN_KEY = 'guidePanelOpen';
const BODY_CLASS = 'show-guide-panel';
// Screens render after the route changes; look for the steps' elements again once
// they had time to appear.
const RECHECK_DELAY_MS = 600;
// Longest the tour waits for the page to widen again after the panel closes
// (the #wrapper margin transition is 0.4s).
const SETTLE_FALLBACK_MS = 600;

function currentRouteName() {
  const current = Router.current();
  return current && current.route && current.route.getName();
}

export function currentGuideId() {
  return guideIdForRoute(currentRouteName());
}

export function openGuidePanel(open) {
  Session.set(OPEN_KEY, open !== false);
}

export function toggleGuidePanel() {
  Session.set(OPEN_KEY, !Session.get(OPEN_KEY));
}

// Calls `callback` once #wrapper has finished sliding back to full width, or at
// once when it does not animate (reduced motion, no wrapper).
function afterWrapperSettles(callback) {
  const wrapper = document.getElementById('wrapper');
  const duration = wrapper ? parseFloat(window.getComputedStyle(wrapper).transitionDuration) || 0 : 0;
  if (!duration) {
    callback();
    return;
  }
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    wrapper.removeEventListener('transitionend', onEnd);
    callback();
  }
  function onEnd(event) {
    if (event.target === wrapper) finish();
  }
  wrapper.addEventListener('transitionend', onEnd);
  Meteor.setTimeout(finish, SETTLE_FALLBACK_MS);
}

/**
 * Runs the tour of guide `guideId`. The panel is closed first so the tour has
 * the whole page, and the tour starts once the page has widened again - it
 * measures the elements when it starts, and would otherwise light them where
 * they were next to the open panel. Returns false when there is no such guide.
 */
export function startGuideTour(guideId, onExit) {
  const guide = getGuide(guideId);
  if (!guide) return false;
  const start = function () {
    startTour(guide.steps, {intro: guide.summary, onExit});
  };
  if (!Session.get(OPEN_KEY)) {
    start();
    return true;
  }
  Session.set(OPEN_KEY, false);
  // Applied now rather than at the next Tracker flush, so the transition starts
  // before afterWrapperSettles looks at it.
  document.body.classList.remove(BODY_CLASS);
  afterWrapperSettles(start);
  return true;
}

// Both of these live at module level, not on a guidePanel instance: each layout
// renders its own panel, and when a navigation swaps layouts the old instance
// is destroyed only after the new one exists, so per-instance code would undo
// the new panel's state or never see the route change.
Meteor.startup(function () {
  Tracker.autorun(function () {
    document.body.classList.toggle(BODY_CLASS, !!Session.get(OPEN_KEY));
  });
  // A tour belongs to the page it started on. Deferred so the router has updated
  // the location by the time it is compared.
  Tracker.autorun(function () {
    Router.current();
    Meteor.defer(endTourIfMovedAway);
  });
});

Template.guidePanel.onCreated(function () {
  const template = this;
  template.domCheck = new ReactiveVar(0);
  template.recheckLater = function () {
    Meteor.clearTimeout(template.recheckTimer);
    template.recheckTimer = Meteor.setTimeout(function () {
      template.domCheck.set(template.domCheck.curValue + 1);
    }, RECHECK_DELAY_MS);
  };

  // Opening the panel or moving to another screen: look for the steps' elements
  // again once the screen had time to render.
  template.autorun(function () {
    Session.get(OPEN_KEY);
    currentRouteName();
    template.recheckLater();
  });
});

Template.guidePanel.onDestroyed(function () {
  Meteor.clearTimeout(this.recheckTimer);
});

Template.guidePanel.helpers({
  isOpen: function () {
    return !!Session.get(OPEN_KEY);
  },
  guide: function () {
    return getGuide(currentGuideId());
  },
  plusOne: function (index) {
    return index + 1;
  },
  isMissing: function (selector) {
    Template.instance().domCheck.get();
    return !!selector && !findGuideElement(selector);
  },
  helpUrl: function () {
    return Config.helpUrl;
  }
});

Template.guidePanel.events({
  'click .guide-panel-close': function (event) {
    event.preventDefault();
    openGuidePanel(false);
  },
  'click .guide-start-tour': function (event) {
    event.preventDefault();
    startGuideTour(currentGuideId());
  },
  'click .guide-step-show': function (event, instance) {
    event.preventDefault();
    highlightElement(event.currentTarget.getAttribute('data-selector'));
    instance.domCheck.set(instance.domCheck.curValue + 1);
  }
});

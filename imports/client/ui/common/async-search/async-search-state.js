import {Template} from 'meteor/templating';
import {i18n} from 'meteor/universe:i18n';
import {PHASE_THRESHOLDS_MS} from './searchPhases';

// Index = phase. The phase-0 and phase-1 slots are deliberately empty: the
// template shows a fixed "Searching..." title from the moment loading starts,
// so a detail line only earns its place once the request is genuinely slow.
const PHASE_KEYS = [null, null, 'SearchStillRunning', 'SearchVerySlow'];

Template.asyncSearchLoading.helpers({
  // Callers outside the lake search (the component index detail page waiting on
  // its vulnerability lookups) reuse this preloader with their own wording.
  loadingTitle: function () {
    return this.title || i18n.__('SearchInProgress');
  },
  phaseText: function () {
    const key = PHASE_KEYS[this.phase];
    return key ? i18n.__(key) : '';
  },
  showRetry: function () {
    // Only once the request has been slow for a long time is offering an escape
    // hatch more helpful than distracting.
    return this.phase >= PHASE_THRESHOLDS_MS.length;
  }
});

Template.asyncSearchError.helpers({
  errorText: function () {
    const error = this.error;
    if (error && error.timeout) {
      return i18n.__('SearchTimedOut');
    }
    if (error && error.message) {
      return error.message;
    }
    return i18n.__('SearchFailedGeneric');
  }
});

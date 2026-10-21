import {Template} from 'meteor/templating';
import {Tracker} from 'meteor/tracker';
import {$} from 'meteor/jquery';

// The license multi-selects of the component edit pages (COTS, infrastructure,
// company component manager). They render behind {{#if isComponentLoaded}}, so on a
// cold load (direct URL, refresh, new tab) they do not exist yet when onRendered
// runs and a one-shot .select2() call finds nothing.
const LICENSE_SELECTS = [
  {selector: '#set-declared-licenses', placeholder: 'Enter declared licenses here'},
  {selector: '#set-effective-licenses', placeholder: 'Enter effective licenses here'},
  {selector: '#set-concluded-licenses', placeholder: 'Enter concluded licenses here'},
  {selector: '#set-license-to-selected', placeholder: 'Check versions and pick license to bulk update'}
];

// Enhance every license select that is in the DOM and not enhanced yet, so calling
// it again never adds a second select2 container.
function initLicenseSelects() {
  LICENSE_SELECTS.forEach(function (cfg) {
    const $el = $(cfg.selector);
    if ($el.length && !$el.hasClass('select2-hidden-accessible')) {
      $el.select2({
        placeholder: cfg.placeholder,
        width: '100%'
      });
    }
  });
}

// Call from onRendered: (re)initialises the selects whenever the component in the
// template's data context is loaded, after Blaze has rendered them.
export function initLicenseSelectsWhenLoaded(instance) {
  instance.autorun(function () {
    const data = Template.currentData();
    if (!(data && typeof data.data === 'function' && data.data())) {
      return;
    }
    Tracker.afterFlush(initLicenseSelects);
  });
}

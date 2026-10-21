/* global document:false, swal:false */
// Manual resolution of an unmatched component license.
//
// Renders ONE section per (module, component) - not one per dependency path -
// because the resolution itself is per (module, component): offering the same
// control N times would invite N identical writes.
//
// Everything shown here is read back from the reactive Modules document
// (componentConfig.licensesSelected). The server method deliberately does NOT
// echo the justification, author or date, so this template must never render
// from its response.
import {Meteor} from 'meteor/meteor';
import {Template} from 'meteor/templating';
import {Tracker} from 'meteor/tracker';
import {ReactiveVar} from 'meteor/reactive-var';
import {Session} from 'meteor/session';
import {$} from 'meteor/jquery';
import {Roles} from 'meteor/alanning:roles';
import {Router} from 'meteor/vlasky:galvanized-iron-router';
import {escapeHtml, formatPath} from '/imports/client/ui/helpers/template-helpers';
import Modules from '/imports/lib/collections/modules';
import Licenses from '/imports/lib/collections/licenses';
import Projects from '/imports/lib/collections/projects';
import Company from '/imports/lib/company/Company';
import Utils from '/imports/lib/utils';
import Notify from '/imports/api/notify';
import {
  collectPolicyStatuses,
  findResolutionEntry,
  isJustificationValid,
  isStaleResolution,
  policyStatusWord,
  resolutionState,
  resolutionView,
  worstPolicyStatus,
  JUSTIFICATION_MAX_LENGTH
} from '/imports/client/ui/module/common/licenseResolution';

const IN_PROGRESS = 'action-in-progress';
const ASIDE_CLASS = '.aside-section-content';
const SELECT_ID_PREFIX = 'licenseResolve-';
const HEADING_ID_PREFIX = 'licenseResolveHeading-';
// Deliberately NOT the shared NOT_ALLOWED constant in the dependency aside
// ('You are not allowed to change this settings!'): it is ungrammatical and it
// talks about settings, which this is not.
const NOT_ALLOWED_LICENSE = 'You are not allowed to set licenses in this module.';
const EMPTY_JUSTIFICATION = 'Please explain why this license applies before you set it.';
// 2000 is VALID: the server rejects only `> 2000` (resolutionEntry.js), so
// "under 2000" would name the wrong limit.
const LONG_JUSTIFICATION = 'The justification is too long - please use 2000 characters or fewer.';
const UNKNOWN_KEY = 'UNKNOWN';
const PATH_PREVIEW_LIMIT = 3;

// BOTH roles, matching the server gate. `add_legal_rule_resolved` in the
// dependency aside checks only 'manager' while its template gate admits both,
// so a compliance manager silently hits "not allowed" there - do not repeat it.
function canSetLicense() {
  const user = Meteor.user();
  const companyId = user && user.profile && user.profile.companyId;
  if (!companyId) return false;
  return Roles.userIsInRole(user, ['compliance_manager', 'manager'], companyId);
}

function idSuffix(componentKey) {
  // Component keys carry ':' and '/' - legal in an id, but not in a CSS
  // selector, and a stray space would make the id invalid outright.
  return String(componentKey || '').replace(/[^A-Za-z0-9_-]/g, '-');
}

function licensesSelectedOf(moduleId) {
  const module = moduleId && Modules.findOne(moduleId, {fields: {componentConfig: 1}});
  return (module && module.componentConfig && module.componentConfig.licensesSelected) || [];
}

function licenseNameOf(key) {
  if (!key) return '';
  const doc = Licenses.findOne({key: key}, {fields: {key: 1, name: 1}});
  return (doc && doc.name) || '';
}

// The company / project / module allow-deny evaluation for one license, exactly
// as the per-path license sections of the dependency aside compute it
// (module-dependencies-aside.js `licenseStatus`). It is recomputed here rather
// than only read back off `status.computedStatus`, because that field is written
// as a SIDE EFFECT of those sections rendering - and they sit below this one, so
// on a first render it does not exist yet and the line would read Pending for a
// license the analyzer has long since judged.
//
// Returns null when the module is not in Minimongo yet; a null contributes no
// status, which is the honest answer rather than a guessed verdict.
function computePolicyStatus(moduleId, licenseKey, status) {
  const module = moduleId && Modules.findOne(moduleId);
  if (!module || typeof module.isLicenseBlacklisted !== 'function') return null;
  const current = Router.current();
  const projectId = current && current.params && current.params.projectId;
  const project = projectId ? Projects.findOne({_id: projectId}) : null;
  return Utils.computedLicenseStatusDetails(module, project,
    new Company(Session.get('company') || {}), licenseKey, status);
}

// The verdicts for the chosen license, one per path it appears on. Nothing is
// invented here: a path the analyzer has not reported on contributes no status,
// and an empty list becomes 'pending'.
function policyStatusesFor(data, licenseKey) {
  return collectPolicyStatuses(data && data.paths, licenseKey, function (key, status) {
    return computePolicyStatus(data && data.moduleId, key, status);
  });
}

function hasAnyLicense(paths) {
  return (paths || []).some(function (item) {
    return !!(item && item.licenseCount > 0);
  });
}

// `data` is the context licenseResolutionContext handed down. Reading the entry
// back out of the reactive Modules document on every helper call is what makes
// the section re-render itself after a save - the server method deliberately
// returns nothing to render from.
function entryOf(data) {
  return findResolutionEntry(licensesSelectedOf(data && data.moduleId), data && data.componentKey);
}

// The analyzer's verdict for whatever license was set manually, or 'pending'.
function verdictOf(data) {
  const entry = entryOf(data);
  return entry ? worstPolicyStatus(policyStatusesFor(data, entry.license)) : 'pending';
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

// Whether a risk entry can exist for this component at all. The entry carries no
// riskId; this mirrors the server's own gate order (a module that belongs to a
// project), so it needs no extra stored field.
//
// Both the green panel's risk line AND the clear dialog read it.
function riskLineApplies(moduleId) {
  const module = moduleId && Modules.findOne(moduleId, {fields: {projectId: 1}});
  return !!(module && module.projectId);
}

// The body of the html:true confirmation dialog.
//
// Component names, license names and dependency paths all come out of scans and
// are attacker-controlled, so EVERY value spliced in here is escaped first and
// carries a `safe` prefix to make that auditable at a glance. `formatPath`
// escapes internally and then adds its own chevron markup.
function buildConfirmationHtml(safeName, safeKey, safeLicenseName, safePaths, safeMore, safePathCount,
  safeVersionCount, safeIsUnknown) {
  // Both nouns are pluralised: the commonest case of all is one path at one
  // version, and "1 paths across 1 versions" is exactly the sentence a
  // compliance manager reads before committing an audit record.
  // `safe`-prefixed like every other value spliced below - each is one of two
  // hardcoded words, so there is nothing here to escape.
  const safePathWord = safePathCount === '1' ? 'path' : 'paths';
  const safeVersionWord = safeVersionCount === '1' ? 'version' : 'versions';
  let html = '<p><b>' + safeKey + '</b>';
  if (safeLicenseName) html = html + ' - ' + safeLicenseName;
  html = html + '</p>';
  html = html + '<p>This applies to every occurrence of ' + safeName + ' in this module - ' +
    safePathCount + ' ' + safePathWord + ' across ' + safeVersionCount + ' ' + safeVersionWord +
    ' - not only the path you selected.</p>';
  if (safePaths.length) {
    html = html + '<div style="max-height: 96px; overflow-y: auto; text-align: left;">';
    for (let i = 0; i < safePaths.length; i++) {
      html = html + '<div>' + safePaths[i] + '</div>';
    }
    html = html + '</div>';
    if (safeMore) {
      html = html + '<p>+ ' + safeMore + ' more</p>';
    }
  }
  html = html + '<p>Setting a license records which license applies. Whether it is allowed is decided by your ' +
    'company policy at the next analysis run - this component may still be reported as a warning or a violation.</p>';
  if (safeIsUnknown) {
    // Deliberately NOT "will be reported as a warning": the constraints ->
    // status mapping lives in the ts-analysis worker (risk R1) and is
    // an unverified hypothesis. Promising a verdict we do not control would put
    // this sentence in direct contradiction with the Policy status line.
    html = html + '<p>"UNKNOWN" records that you investigated and could not determine the license. It does not ' +
      'clear the component - your policy still decides how it is reported.</p>';
  }
  // id / class / rows are the shared confirm-dialog contract in this aside:
  // every other confirmation here reads back
  // document.getElementById('confirmationText').value.
  html = html + '<label for="confirmationText">Why does this license apply? (required)</label>' +
    '<textarea id="confirmationText" class="form-control inner-t-5" rows="6" maxlength="2000"></textarea>';
  return html;
}

// SweetAlert 1.x focuses its confirm button, so the textarea has to be claimed
// back after the dialog is on screen.
function focusJustification() {
  Meteor.setTimeout(function () {
    const textarea = document.getElementById('confirmationText');
    if (textarea) textarea.focus();
  }, 60);
}

// Focus must never be left on document.body when a dialog closes or a section
// re-renders the control away.
function restoreFocus(element) {
  if (element && typeof element.focus === 'function' && document.body.contains(element)) {
    element.focus();
  }
}

function focusHeading(componentKey) {
  Tracker.afterFlush(function () {
    const heading = document.getElementById(HEADING_ID_PREFIX + idSuffix(componentKey));
    if (heading) heading.focus();
  });
}

Template.componentLicenseResolve.onCreated(function () {
  this.draftLicense = new ReactiveVar('');
  this.saving = new ReactiveVar(false);
});

Template.componentLicenseResolve.helpers({
  canSetLicense: function () {
    return canSetLicense();
  },

  selectId: function () {
    return SELECT_ID_PREFIX + idSuffix(this.componentKey);
  },

  headingId: function () {
    return HEADING_ID_PREFIX + idSuffix(this.componentKey);
  },

  manual: function () {
    return resolutionView(entryOf(this));
  },

  isResolved: function () {
    return !!entryOf(this);
  },

  isReasonState: function () {
    return resolutionState(this, licensesSelectedOf(this.moduleId)) === 'unmatched-reason';
  },

  licenseName: function () {
    const entry = entryOf(this);
    return entry ? licenseNameOf(entry.license) : '';
  },

  sectionStatus: function () {
    // Yellow while the license is unknown, green once it has been recorded.
    // This answers "do we know which license applies?" and nothing else - the
    // policy verdict is a separate line, in words.
    return entryOf(this) ? 'ok' : 'warnings';
  },

  policyStatus: function () {
    return verdictOf(this);
  },

  policyWord: function () {
    return policyStatusWord(verdictOf(this));
  },

  isPolicyPending: function () {
    return verdictOf(this) === 'pending';
  },

  isStale: function () {
    return isStaleResolution(entryOf(this), this.analysisDate, hasAnyLicense(this.paths));
  },

  staleDate: function () {
    return formatDate(this.analysisDate);
  },

  showRiskLine: function () {
    return riskLineApplies(this.moduleId);
  },

  // The risks page needs BOTH ids; with neither it renders only "Please select
  // the project to run a report on the upper right", so a bare pathFor sends the
  // reader to an empty screen. Read off the module rather than the router so the
  // link is right wherever this template is mounted.
  riskQuery: function () {
    const module = this.moduleId && Modules.findOne(this.moduleId, {fields: {projectId: 1}});
    if (!module || !module.projectId) return {};
    return {projectId: module.projectId, moduleId: this.moduleId};
  },

  pathWord: function () {
    return this.pathCount === 1 ? 'path' : 'paths';
  },

  draftLicense: function () {
    return Template.instance().draftLicense.get();
  },

  isSaving: function () {
    return Template.instance().saving.get();
  }
});

// Opens the confirmation for the license currently held in `draftLicense`.
//
// Picking a license runs this straight away - there is no separate "apply"
// button. The dialog is the real commit point (nothing is written until it is
// confirmed AND carries a justification), so a second click only added a step
// between the choice and the question about it.
//
// `trigger` is the element focus returns to when the dialog is dismissed.
function openSetLicenseDialog(instance, trigger) {
  if (!canSetLicense()) {
    Notify.danger(NOT_ALLOWED_LICENSE);
    return;
  }
  const data = instance.data;
  const chosen = instance.draftLicense.get();
  if (!chosen || !data || !data.moduleId || !data.componentKey) return;

  const safeName = escapeHtml(data.componentName || data.componentKey);
  const safeKey = escapeHtml(chosen);
  const safeLicenseName = escapeHtml(licenseNameOf(chosen));
  const safePaths = (data.paths || []).slice(0, PATH_PREVIEW_LIMIT).map(function (item) {
    return formatPath(item.path);
  });
  const hidden = (data.paths || []).length - safePaths.length;
  const safeMore = hidden > 0 ? String(hidden) : '';
  const safePathCount = String(data.pathCount || 0);
  const safeVersionCount = String(data.versionCount || 0);

  swal({
    title: 'Set the license for ' + safeName + '?',
    text: buildConfirmationHtml(safeName, safeKey, safeLicenseName, safePaths, safeMore,
      safePathCount, safeVersionCount, chosen === UNKNOWN_KEY),
    html: true,
    showCancelButton: true,
    // NOT the #cf4747 used by add_legal_rule_resolved: red there means
    // "accepting a known risk", and this is a factual declaration. #063d50
    // also clears ~12:1 against white, where the app teal fails at 3.6:1.
    confirmButtonColor: '#063d50',
    confirmButtonText: 'Set license',
    cancelButtonText: 'Cancel'
  }, function (confirmed) {
    if (confirmed === false) {
      // Put the picker back to its placeholder. Without this the select still
      // shows the abandoned choice, and re-picking THAT SAME license fires no
      // `change` event - so the dialog could never be reopened for it.
      instance.draftLicense.set('');
      restoreFocus(trigger);
      return false;
    }
    const textarea = document.getElementById('confirmationText');
    const justification = textarea ? textarea.value : '';
    if (!isJustificationValid(justification)) {
      Notify.warn(justification && justification.length > JUSTIFICATION_MAX_LENGTH ?
        LONG_JUSTIFICATION : EMPTY_JUSTIFICATION);
      instance.draftLicense.set('');
      restoreFocus(trigger);
      return false;
    }
    const moduleId = data.moduleId;
    const componentKey = data.componentKey;
    instance.saving.set(true);
    // Keep the element the overlay was put on. `$(ASIDE_CLASS)` matches EVERY
    // aside section in the document, so removing by selector would also clear
    // the overlay from a sibling section that is still saving under it.
    const overlay = $(trigger).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
    Meteor.callAsync('Modules.ResolveComponentLicense', moduleId, componentKey, chosen, justification)
      .then(function (res) {
        instance.draftLicense.set('');
        // The trigger is gone once the section re-renders green, so focus
        // moves to the section heading rather than falling to <body>.
        focusHeading(componentKey);
        if (!res.changed) return;
        Notify.info('License set to "' + chosen + '". Re-analysing…');
        // Fire-and-forget: the analysis is async, so the section shows
        // "Pending" until the analyzer actually reports back.
        Meteor.callAsync('Modules.PropagateLicensePicks', moduleId).catch(console.error);
      })
      .catch(function (error) {
        Notify.danger('Could not set the license: ' + (error.reason || error.message));
        // Reset here too. While there was an apply button, holding the draft
        // let the user retry with one click; now the picker IS the trigger, so
        // a stuck value is what blocks the retry instead of enabling it.
        instance.draftLicense.set('');
        restoreFocus(trigger);
      })
      .finally(function () {
        instance.saving.set(false);
        overlay.removeClass(IN_PROGRESS);
      });
  });
  focusJustification();
}

Template.componentLicenseResolve.events({
  'change .license-catalog-select': function (event, instance) {
    const chosen = event.target.value || '';
    instance.draftLicense.set(chosen);
    if (!chosen) return;
    openSetLicenseDialog(instance, event.target);
  },

  'click .clear-component-license': function (event, instance) {
    event.preventDefault();
    const trigger = event.currentTarget;
    if (!canSetLicense()) {
      Notify.danger(NOT_ALLOWED_LICENSE);
      return;
    }
    const data = instance.data;
    const view = resolutionView(entryOf(data));
    if (!view) return;

    const safeName = escapeHtml(data.componentName || data.componentKey);
    const safeAuthor = escapeHtml(view.author);
    const safeDate = escapeHtml(view.date);
    // Gated on exactly the condition the green panel's risk line uses, so the
    // dialog can never promise a Risk management entry to a company that has no
    // Risk management - and, when it does show, it says what to do about it.
    const safeRiskSentence = riskLineApplies(data.moduleId) ?
      ' Any risk entry created for it stays in Risk management - remove it there if it no longer applies.' : '';

    swal({
      title: 'Clear the manual license?',
      text: 'The license for ' + safeName + ' goes back to "not detected" in this module, and the justification ' +
        'recorded by ' + safeAuthor + ' on ' + safeDate + ' is removed.' + safeRiskSentence,
      html: true,
      showCancelButton: true,
      // Red here is right: this one destroys an audit record.
      confirmButtonColor: '#cf4747',
      confirmButtonText: 'Clear license',
      cancelButtonText: 'Cancel'
    }, function (confirmed) {
      if (confirmed === false) {
        restoreFocus(trigger);
        return false;
      }
      const moduleId = data.moduleId;
      const componentKey = data.componentKey;
      instance.saving.set(true);
      const overlay = $(trigger).closest(ASIDE_CLASS).addClass(IN_PROGRESS);
      Meteor.callAsync('Modules.ClearComponentLicenseResolution', moduleId, componentKey)
        .then(function (res) {
          // The undo button is gone once the section re-renders yellow.
          focusHeading(componentKey);
          if (!res.changed) return;
          Notify.info('Manual license cleared. Re-analysing…');
          Meteor.callAsync('Modules.PropagateLicensePicks', moduleId).catch(console.error);
        })
        .catch(function (error) {
          Notify.danger('Could not clear the license: ' + (error.reason || error.message));
          restoreFocus(trigger);
        })
        .finally(function () {
          instance.saving.set(false);
          overlay.removeClass(IN_PROGRESS);
        });
    });
  }
});

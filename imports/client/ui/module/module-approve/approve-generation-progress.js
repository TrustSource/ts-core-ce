import {Template} from 'meteor/templating';

// Real, status-driven approval-creation progress. Reads the approve doc's
// `generation` object delivered reactively via the `approveDetail` subscription.
// There is NO timer here: the bars reflect actual backend stage state, and the
// terminal banner gates STRICTLY on generation.status - never on "bars look
// full" (the bug this replaces).
//
// Interface contract (read-only on this side, shape owned by the backend):
//   approve.generation = {
//     status:   'pending' | 'running' | 'done' | 'failed',
//     stages:   { report, notice, sbom }  // each: pending|running|done|failed|skipped
//     current:  'report'|'notice'|'sbom'|null,
//     startedAt, finishedAt, error
//   }

// The 3 user-visible stages, in contract order.
const STAGE_ORDER = ['report', 'notice', 'sbom'];

const STAGE_LABELS = {
  report: 'Compliance Report',
  notice: 'Notice',
  sbom: 'SBOM'
};

// aria-label phrasing per running/skipped stage.
const STAGE_RUNNING_ARIA = {
  report: 'Compliance Report generating',
  notice: 'Notice report generating',
  sbom: 'SBOM report generating'
};
const STAGE_SKIPPED_ARIA = {
  report: 'Compliance Report not applicable',
  notice: 'Notice not applicable',
  sbom: 'SBOM not applicable'
};

// Resolve the approve doc passed via {{> approveGenerationProgress approveData=...}}.
function approve() {
  const data = Template.currentData();
  return (data && data.approveData) || {};
}

// Read the generation sub-doc, treating absent as all-pending (legacy approves).
function generation() {
  const a = approve();
  return (a && a.generation) || {};
}

function stages() {
  return generation().stages || {};
}

// Legacy/safety: an old approve may have no `generation`. Infer 'done' when it is
// `processed` AND all backing fields are present (sbom, notice, stats) so
// revisited old approves don't show a perpetual "Queued"/blank screen. Returns
// true only for these legacy-complete approves; modern approves carry
// generation.status and don't reach this.
function legacyDone() {
  const a = approve();
  if (a.generation) return false;
  if (!a.processed) return false;
  // The always-generated reports must all be backed.
  return !!a.sbomFileId && !!a.noticeFileId && !!a.stats;
}

// Effective generation.status, accounting for legacy approves with no generation.
function effectiveStatus() {
  const g = generation();
  if (g.status) return g.status;
  if (legacyDone()) return 'done';
  // No generation, not legacy-complete: behave as pending (no banner, not blank).
  return 'pending';
}

// State of a single stage. For legacy-complete approves we surface 'done' on the
// backed stages so the rows render coherently rather than perpetual "Queued".
function stageState(key) {
  const s = stages()[key];
  if (s) return s;
  if (legacyDone()) {
    return 'done';
  }
  return 'pending';
}

// Whether a stage's backing report field is set (drives the View link).
function stageFieldSet(key) {
  const a = approve();
  switch (key) {
  case 'report': return !!a.stats;
  case 'notice': return !!a.noticeFileId;
  case 'sbom': return !!a.sbomFileId;
  default: return false;
  }
}

// Per-stage View link: the Iron Router route name + its options. Computed on the
// row (not via Template.currentData) because inside {{#each}} the data context is
// the row, so approve() would no longer resolve the parent doc.
function stageLink(key, a) {
  switch (key) {
  case 'report': return {route: 'approvesDetails', options: {approveId: a._id}};
  case 'notice': return {route: 'noticeFileDetails', options: {noticeId: a.noticeFileId}};
  case 'sbom': return {route: 'sbomFileDetails', options: {sbomId: a.sbomFileId}};
  default: return null;
  }
}

// Build the per-stage view model the template iterates over.
function stageRows() {
  const a = approve();
  const cur = generation().current;
  return STAGE_ORDER.map(function (key) {
    let state = stageState(key);
    // Reflect the backend's `current` pointer as the running stage even if the
    // stages map hasn't flipped it yet.
    if (state === 'pending' && cur === key && effectiveStatus() === 'running') {
      state = 'running';
    }
    const link = stageLink(key, a);
    return {
      key: key,
      label: STAGE_LABELS[key],
      state: state,
      fieldSet: stageFieldSet(key),
      isReport: key === 'report',
      linkRoute: link.route,
      linkOptions: link.options
    };
  });
}

// Count of stages that are terminally accounted for (done or skipped).
function doneCount() {
  return stageRows().reduce(function (n, row) {
    return n + (row.state === 'done' || row.state === 'skipped' ? 1 : 0);
  }, 0);
}

Template.approveGenerationProgress.helpers({
  // --- Overall bar ----------------------------------------------------------
  // Determinate width once anything is accounted for; while merely starting
  // (status pending, nothing done) the bar is indeterminate.
  overallDeterminate: function () {
    return doneCount() > 0 || effectiveStatus() === 'done' || effectiveStatus() === 'failed';
  },

  overallPercent: function () {
    return Math.round((doneCount() / STAGE_ORDER.length) * 100);
  },

  overallCaption: function () {
    return doneCount() + ' of ' + STAGE_ORDER.length + ' done';
  },

  overallBarClass: function () {
    const status = effectiveStatus();
    if (status === 'failed') return 'progress-bar progress-bar-danger';
    if (status === 'done') return 'progress-bar progress-bar-success';
    if (doneCount() > 0) return 'progress-bar';
    return 'progress-bar progress-bar-striped active';
  },

  // Blaze dynamic-attributes object (per CLAUDE.md): a bare {{helper}} in the
  // start tag returns name/value attribute pairs. Returning aria-valuenow as a
  // string would make Blaze treat the whole string as the attribute name and
  // throw InvalidCharacterError - so emit a value object instead.
  overallBarAttrs: function () {
    if (doneCount() > 0 || effectiveStatus() === 'done' || effectiveStatus() === 'failed') {
      return {'aria-valuenow': String(Math.round((doneCount() / STAGE_ORDER.length) * 100))};
    }
    return {'aria-label': 'Generating approval reports'};
  },

  // --- Per-stage rows -------------------------------------------------------
  stageRows: function () {
    return stageRows();
  },

  stageIcon: function () {
    switch (this.state) {
    case 'running': return 'fa fa-spinner fa-spin';
    case 'done': return 'fa fa-check-circle text-success';
    case 'skipped': return 'fa fa-minus-circle text-muted';
    case 'failed': return 'fa fa-times-circle text-danger';
    default: return 'fa fa-clock-o text-muted';
    }
  },

  stageStatusText: function () {
    switch (this.state) {
    case 'running': return 'Working …';
    case 'done': return 'Done';
    case 'skipped': return 'Not applicable';
    case 'failed': return 'Failed';
    default: return 'Queued';
    }
  },

  // Show the View link when the stage is terminal-with-output (done or failed
  // but its backing field already exists).
  showStageLink: function () {
    return this.fieldSet && (this.state === 'done' || this.state === 'failed');
  },

  // Link text: "View details ›" for the compliance report, "View report ›" else.
  stageLinkText: function () {
    return this.isReport ? 'View details ›' : 'View report ›';
  },

  stageLinkAriaLabel: function () {
    if (this.isReport) return 'View Compliance Report details';
    return 'View ' + this.label + ' report';
  },

  // Helper-returns-string pattern for the bare class attribute on the bar fill.
  stageBarClass: function () {
    switch (this.state) {
    case 'running': return 'progress-bar progress-bar-striped active';
    case 'done': return 'progress-bar progress-bar-success';
    case 'failed': return 'progress-bar progress-bar-danger';
    case 'skipped': return 'progress-bar approve-progress-track';
    default: return 'progress-bar';
    }
  },

  // Bar fill width: full for terminal/running states, empty (0) while queued.
  stageBarWidth: function () {
    return this.state === 'pending' ? 0 : 100;
  },

  // Dynamic-attributes object for the per-stage progressbar (see overallBarAttrs).
  stageBarAttrs: function () {
    if (this.state === 'running') {
      return {'aria-label': STAGE_RUNNING_ARIA[this.key] || (this.label + ' generating')};
    }
    if (this.state === 'skipped') {
      return {'aria-label': STAGE_SKIPPED_ARIA[this.key] || (this.label + ' not applicable')};
    }
    return {'aria-valuenow': String(this.state === 'pending' ? 0 : 100)};
  },

  // --- Terminal banners -----------------------------------------------------
  isDone: function () {
    return effectiveStatus() === 'done';
  },

  isFailed: function () {
    return effectiveStatus() === 'failed';
  },

  // Keep the existing draft-vs-forwarded copy branch.
  getDry: function () {
    return approve().draft;
  },

  generationError: function () {
    return generation().error;
  }
});

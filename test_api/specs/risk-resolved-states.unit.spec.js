/* eslint-disable no-undef */
// ---------------------------------------------------------------------------
// RESOLVED_RISK_STATES - "a risk that was eliminated is not open".
//
// User-visible behaviour: an eliminated risk is counted as resolved in the
// risk lists and the portfolio widgets, the same as in the threat model.
//
// The fix is a single shared array replacing four hand-copied literals. Nothing
// in the commit tests it, and the failure mode it fixes is drift - a fifth call
// site, or a fifth literal, quietly reintroducing the same bug. The `getStats`
// helpers that consume it are Blaze template helpers over Session data and are
// not worth lifting; what IS worth pinning is the constant and the absence of
// any remaining copy of it.
//
// Two of the three checks below are text checks against the shipped source, so
// they read it with comments stripped - a call site that had its shared import
// commented out must not pass as migrated.
// ---------------------------------------------------------------------------
const {loadMeteorModule, readSourceWithoutComments} = require('../helpers/loadMeteorModule');

// riskSchema.js only touches SimpleSchema.RegEx.Id at module scope.
const SimpleSchemaStub = function () { return {}; };
SimpleSchemaStub.RegEx = {Id: /^[a-zA-Z0-9]{17}$/};

const {RESOLVED_RISK_STATES, RISK_STATE_VALUES, OVERDUE_RISK_STATES, OPEN_RISK_WARNING_STATES} =
  loadMeteorModule('imports/lib/schemas/riskSchema.js', {
    'meteor/aldeed:simple-schema': {SimpleSchema: SimpleSchemaStub},
    '/imports/lib/interactors/riskProperties/riskOrigin':
      {RISK_ORIGIN_VALUES: [], RISK_ORIGIN_OPTIONS: []},
    // managedFields re-exports the four states a SARIF import must never write to
    // from the same module the server writer reads them from. Not what this spec
    // is about, but the loader needs every import stubbed.
    '/imports/lib/interactors/riskProperties/managedFields':
      {UNTOUCHED_RISK_STATES: []}
  });

// Every place that decides "is this risk still open?".
const CALL_SITES = [
  'imports/client/ui/risks/risks.js',
  'imports/client/ui/risks/common/risks-portfolio-new.js',
  'imports/client/ui/risks/common/risks-portfolio-unmitigated.js',
  'imports/client/ui/common/risk-settings-list/risk-settings-list.js'
];

describe('#112 the shared resolved-state list', () => {
  it('is exported and contains eliminated - the state the fix was about', () => {
    expect(Array.isArray(RESOLVED_RISK_STATES)).toBe(true);
    expect(RESOLVED_RISK_STATES).toContain('eliminated');
  });

  it('is exactly the five states the lists treat as dealt with', () => {
    expect(RESOLVED_RISK_STATES.slice().sort())
      .toEqual(['accepted', 'closed', 'eliminated', 'out-of-scope', 'transferred']);
  });

  // #32: the tiles counted deferred as resolved while the treemap showed it red.
  it('keeps deferred and expired open, as the overdue states the treemap shows red', () => {
    expect(OVERDUE_RISK_STATES).toEqual(['deferred', 'expired']);
    OVERDUE_RISK_STATES.forEach((state) => {
      expect(RESOLVED_RISK_STATES).not.toContain(state);
    });
  });

  it('splits every state into exactly one of resolved, overdue and warning', () => {
    expect(OPEN_RISK_WARNING_STATES).toEqual(
      ['identified', 'assessed', 'approved', 'planned', 'implementing', 'monitored', 'escalated']);
    RISK_STATE_VALUES.filter(Boolean).forEach((state) => {
      const groups = [RESOLVED_RISK_STATES, OVERDUE_RISK_STATES, OPEN_RISK_WARNING_STATES]
        .filter((list) => list.indexOf(state) > -1);
      expect(groups).toHaveLength(1);
    });
  });

  it('names only states a risk can actually be in', () => {
    // A typo here would silently never match, which is the same invisible
    // failure the bug had - so check every entry against the schema's enum.
    RESOLVED_RISK_STATES.forEach((state) => {
      expect(RISK_STATE_VALUES).toContain(state);
    });
  });

  it('leaves the working states open, in both directions', () => {
    ['identified', 'assessed', 'approved', 'planned', 'implementing', 'monitored', 'escalated']
      .forEach((state) => {
        expect(RESOLVED_RISK_STATES).not.toContain(state);
      });
  });
});

describe('#112 no view keeps its own copy of the list any more', () => {
  CALL_SITES.forEach((file) => {
    it(`${file} imports the shared array and declares no literal of its own`, () => {
      const source = readSourceWithoutComments(file);
      expect(source).toContain(
        "import {RESOLVED_RISK_STATES} from '/imports/lib/schemas/riskSchema'");
      expect(source).toMatch(/const resolvedStates = RESOLVED_RISK_STATES/);
      // The literal these four had drifted apart with.
      expect(source).not.toMatch(/resolvedStates\s*=\s*\[/);
      expect(source).not.toContain("'accepted', 'closed'");
    });
  });

  it('no other file in the repo has grown a fresh copy', () => {
    // A grep, but over comment-stripped source and asserting the whole set of
    // hits rather than "none", so the schema's own definition is accounted for
    // instead of being excluded by a pattern that could hide a real one.
    const {execSync} = require('child_process');
    const path = require('path');
    const hits = execSync(
      "grep -rl \"'accepted', 'closed'\" imports/ || true",
      {cwd: path.join(__dirname, '../..'), encoding: 'utf8'})
      .split('\n').filter(Boolean)
      .filter((file) => readSourceWithoutComments(file).indexOf("'accepted', 'closed'") !== -1);

    // Only riskSchema.js may spell the states out, and there only twice: the
    // full RISK_STATE_VALUES enum and RESOLVED_RISK_STATES itself.
    expect(hits).toEqual(['imports/lib/schemas/riskSchema.js']);
  });
});

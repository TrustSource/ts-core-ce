/* eslint-disable no-undef */
// Static-source regression: the 3 license selects + the bulk
// "set license to selected" select on the component edit page were not turned
// into working select2 controls after a hard refresh / open-in-new-tab (cold
// load). Root cause: onRendered called .select2() once, before the gated
// <select> elements existed (the edit body is behind {{#if isComponentLoaded}}),
// so select2 hit an empty set and did nothing. The fix re-initializes select2
// reactively, once the component doc AND the license option list have arrived,
// guarded so it can never double-initialize.
//
// WHY this is a source-text proxy and not a behavioural render test:
// the fix lives in imports/client/ui/component/component-details/
// component-details-edit.js, which imports meteor/meteor, meteor/templating,
// meteor/jquery and select2. That module cannot be require()d under the
// jest/node harness (no Meteor runtime, no DOM), and the fixed function
// (initLicenseSelects) is neither exported nor DOM-reachable here. There is no
// jsdom/Blaze/select2 harness in this repo, so the browser-observable
// acceptance criteria (select2 actually renders on cold load, add/remove
// persists, bulk apply works, no console errors) can only be proven by a
// jsdom-based Blaze component harness or a Playwright/Puppeteer E2E - see the
// Coverage Gaps section of the automation report. This spec therefore locks in
// the DESIGN of the fix (reactive dual-gated re-init + idempotency + removal of
// the old one-shot blanket call) so a refactor that reintroduces the cold-load
// timing bug is caught in CI. It mirrors the existing
// approve-generation-progress-logic.frontend.unit.spec.js precedent.
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(
  __dirname,
  '../../imports/client/ui/component/component-details/component-details-edit.js'
);
const raw = fs.readFileSync(SRC_PATH, 'utf8');
// Strip comments so a pattern that only survives in a comment cannot pass.
const code = raw
  .replace(/\/\/[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('#96 component edit license selects - module wiring', () => {
  it('imports the Components collection (needed for the reactive component-ready gate)', () => {
    // The new gate reads Components.findOne(componentId); without this import the
    // autorun would throw / never fire and the cold-load fix would not work.
    expect(code).toMatch(
      /import\s+Components\s+from\s+'\/imports\/lib\/collections\/components'/
    );
  });
});

describe('#96 LICENSE_SELECTS - all four targets are covered', () => {
  // Isolate the LICENSE_SELECTS array so counting selectors is unambiguous.
  const arr = code.match(/LICENSE_SELECTS\s*=\s*\[([\s\S]*?)\]/);

  it('defines the LICENSE_SELECTS config list', () => {
    expect(arr).not.toBeNull();
  });

  it('covers the declared-licenses select (acceptance criterion 1)', () => {
    expect(arr[1]).toMatch(/'#set-declared-licenses'/);
  });

  it('covers the effective-licenses select (acceptance criterion 2)', () => {
    expect(arr[1]).toMatch(/'#set-effective-licenses'/);
  });

  it('covers the concluded-licenses select (acceptance criterion 3)', () => {
    expect(arr[1]).toMatch(/'#set-concluded-licenses'/);
  });

  it('covers the bulk "set license to selected" select via SET_LICENSE (acceptance criterion 6)', () => {
    expect(code).toMatch(/SET_LICENSE\s*=\s*'#set-license-to-selected'/);
    expect(arr[1]).toMatch(/\bSET_LICENSE\b/);
  });

  it('lists exactly four selects - no more, no fewer (criteria 1-3 + bulk)', () => {
    const selectorCount = (arr[1].match(/selector\s*:/g) || []).length;
    expect(selectorCount).toBe(4);
  });
});

describe('#96 initLicenseSelects - idempotent (no double-init, acceptance criterion 7)', () => {
  const fn = code.match(/function initLicenseSelects\s*\(\)\s*\{([\s\S]*?)\n\}/);

  it('defines the initLicenseSelects helper iterating LICENSE_SELECTS', () => {
    expect(fn).not.toBeNull();
    expect(fn[1]).toMatch(/LICENSE_SELECTS/);
  });

  it('only enhances elements not already carrying the select2-hidden-accessible marker', () => {
    // This is the guard that makes repeated calls safe. Without it, the reactive
    // re-run (and the bulk-create re-init) would double-apply select2 and
    // duplicate the rendered container - the concrete failure criterion 7 forbids.
    expect(fn[1]).toMatch(
      /if\s*\(\s*\$el\.length\s*&&\s*!\$el\.hasClass\(\s*'select2-hidden-accessible'\s*\)\s*\)/
    );
    expect(fn[1]).toMatch(/\$el\.select2\(/);
  });
});

describe('#96 onRendered - reactive dual-gated re-init (cold-load fix, criteria 1-4)', () => {
  const rendered = code.match(
    /onRendered\s*\(function\s*\(\)\s*\{([\s\S]*?)\n\}\);/
  );

  it('resolves the componentId from the current route params', () => {
    expect(rendered).not.toBeNull();
    expect(rendered[1]).toMatch(/componentId\s*=\s*Router\.current\(\)[\s\S]*params\._id/);
  });

  it('registers a reactive this.autorun (not a one-shot init) so init survives the cold load', () => {
    // The whole bug was a single onRendered .select2() firing before the gated
    // selects existed. The fix must be reactive; assert the autorun is present.
    expect(rendered[1]).toMatch(/this\.autorun\(function\s*\(\)/);
  });

  it('gates on the component document arriving (Components.findOne)', () => {
    expect(rendered[1]).toMatch(/Components\.findOne\(\s*componentId/);
  });

  it('gates on the license options arriving (Licenses.find(...).count())', () => {
    // Selects render empty options until the licenses subscription resolves;
    // initialising before that produces an empty select2. Must wait for >= 1.
    expect(rendered[1]).toMatch(/Licenses\.find\([\s\S]*?\)\.count\(\)/);
    expect(rendered[1]).toMatch(/optionsCount\s*<\s*1/);
  });

  it('bails until BOTH gates pass, then inits after the DOM settles (Tracker.afterFlush)', () => {
    expect(rendered[1]).toMatch(/if\s*\(\s*!componentReady\s*\|\|\s*optionsCount\s*<\s*1\s*\)\s*\{[\s\S]*?return/);
    expect(rendered[1]).toMatch(/Tracker\.afterFlush\(\s*initLicenseSelects\s*\)/);
  });
});

describe('#96 no regression - old one-shot blanket select2 call is gone (criteria 4 & 7)', () => {
  it('does NOT re-introduce the blanket $("select.select2:visible").select2() init', () => {
    // The pre-fix code re-applied select2 to every visible .select2 on the page,
    // which both raced the render and risked double-init. It must stay removed.
    expect(code).not.toMatch(/select\.select2:visible/);
  });

  it('bulkCreateVersions re-inits new version rows via the guarded initLicenseSelects', () => {
    const fn = code.match(/function bulkCreateVersions\s*\([\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    // Newly created version rows render #set-license-to-selected for the first
    // time; re-init must go through the idempotent helper, not a blanket call.
    expect(fn[0]).toMatch(/Meteor\.setTimeout\(\s*initLicenseSelects\s*,\s*1\s*\)/);
  });
});

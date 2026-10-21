/* eslint-disable no-undef */
// Regression: the multi-license dialog ("Select license for
// component") sometimes opened twice. Two compounding causes:
//
//   Cause 1: the trigger <a> carried BOTH an active Blaze click-open
//            (class showComponentMultyLicense -> $('#…').modal('show')) AND
//            Bootstrap's declarative data-toggle="modal" data-target - two open
//            mechanisms on one click.
//   Cause 2: modalVisible was a GLOBAL Session var, but the template renders
//            once per dependency path inside {{#each}}. Flipping the global
//            reactively rendered EVERY instance's modal under the same
//            id="componentMultyLicense" -> the global show.bs.modal body-move +
//            modal('show') behaved non-deterministically.
//
// The DOM-level "shown exactly once" criteria need a Blaze/jsdom harness that
// this repo does not have, so they are asserted here as static-source
// invariants on the fix (no Meteor import - runs serverless under Jest). The
// buildLicensesSelected payload (criteria 5/6) is verified for real against the
// extracted pure helper.
const fs = require('fs');
const path = require('path');

const {buildLicensesSelected} = require(
  '../../imports/client/ui/module/common/multyLicenseSelect'
);

const htmlSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/client/ui/module/common/component-multy-license.html'),
  'utf8'
);
const jsSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/client/ui/module/common/component-multy-license.js'),
  'utf8'
);
const jsCode = jsSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#87 multi-license trigger - single open mechanism (criterion 1)', () => {
  it('drops Bootstrap declarative auto-open from the trigger <a>', () => {
    expect(htmlSrc).not.toMatch(/data-toggle\s*=\s*["']modal["']/);
    expect(htmlSrc).not.toMatch(/data-target\s*=\s*["']#componentMultyLicense["']/);
  });

  it('keeps the Blaze click-open class (captures the clicked component)', () => {
    expect(htmlSrc).toContain('showComponentMultyLicense');
    expect(jsCode).toMatch(/'click \.showComponentMultyLicense'/);
    expect(jsCode).toContain('_multyLicenseComponent');
  });

  // Tightened to the trigger <a> element itself (criterion 1). The file-wide
  // assertions above would miss a regression that re-attached data-toggle to a
  // DIFFERENT element while leaving the trigger clean, or vice-versa; scoping to
  // the exact <a class="...showComponentMultyLicense..."> tag closes that gap.
  it('the trigger <a> itself carries NEITHER data-toggle nor data-target (criterion 1)', () => {
    // Isolate the opening tag of the trigger anchor: <a ... showComponentMultyLicense ...>
    const triggerTag = htmlSrc.match(/<a\b[^>]*\bshowComponentMultyLicense\b[^>]*>/);
    expect(triggerTag).not.toBeNull();
    const tag = triggerTag[0];
    expect(tag).not.toMatch(/data-toggle/);
    expect(tag).not.toMatch(/data-target/);
  });

  it('declares no data-toggle="modal" anywhere in the template markup (criterion 1)', () => {
    // Bootstrap's declarative open is fully gone - not just off the trigger.
    expect(htmlSrc).not.toMatch(/data-toggle\s*=\s*["']modal["']/);
  });
});

describe('#87 buildLicensesSelected - dedup & resilience edge cases (criteria 5/6)', () => {
  it('collapses pre-existing DUPLICATE entries for the clicked key to exactly one', () => {
    // The double-render bug could persist two entries under the same key; the
    // rebuild must remove ALL of them, then append exactly one fresh entry.
    const current = [
      {key: 'compA', license: 'GPL-2.0', comment: 'first'},
      {key: 'compA', license: 'BSD-3-Clause', comment: 'second'}
    ];
    const out = buildLicensesSelected(current, 'compA', 'MIT', 'fresh');
    expect(out.filter(e => e.key === 'compA')).toHaveLength(1);
    expect(out).toEqual([{key: 'compA', license: 'MIT', comment: 'fresh'}]);
  });

  it('removes the clicked key when it is sandwiched between other components', () => {
    // Position-independent dedup: clicked key in the middle, neighbours kept in order.
    const current = [
      {key: 'compA', license: 'Apache-2.0', comment: 'a'},
      {key: 'compB', license: 'GPL-2.0', comment: 'b-old'},
      {key: 'compC', license: 'ISC', comment: 'c'}
    ];
    const out = buildLicensesSelected(current, 'compB', 'MIT', 'b-new');
    expect(out).toHaveLength(3);
    // Other components survive untouched...
    expect(out).toContainEqual({key: 'compA', license: 'Apache-2.0', comment: 'a'});
    expect(out).toContainEqual({key: 'compC', license: 'ISC', comment: 'c'});
    // ...and there is exactly one (rebuilt) entry for the clicked key.
    expect(out.filter(e => e.key === 'compB')).toHaveLength(1);
    expect(out).toContainEqual({key: 'compB', license: 'MIT', comment: 'b-new'});
  });

  it('re-selecting the ALREADY-selected license stays idempotent (no duplicate)', () => {
    const current = [{key: 'compA', license: 'MIT', comment: 'orig'}];
    const out = buildLicensesSelected(current, 'compA', 'MIT', 'orig');
    expect(out).toEqual([{key: 'compA', license: 'MIT', comment: 'orig'}]);
    expect(out.filter(e => e.key === 'compA')).toHaveLength(1);
  });

  it('tolerates null entries inside the current array without throwing (filter guard path)', () => {
    // The helper guards with `!e || e.key !== key`: the `!e` arm is purely to
    // avoid a TypeError on `null.key` - it does NOT remove null entries, it keeps
    // them. So the documented behaviour is: nulls pass through untouched, the
    // clicked key is still rebuilt to exactly one fresh entry, and no throw.
    const current = [null, {key: 'compA', license: 'GPL-2.0', comment: 'a'}, null];
    let out;
    expect(() => {
      out = buildLicensesSelected(current, 'compA', 'MIT', 'a2');
    }).not.toThrow();
    // exactly one rebuilt entry for the clicked key, regardless of the nulls
    expect(out.filter(e => e && e.key === 'compA')).toEqual([
      {key: 'compA', license: 'MIT', comment: 'a2'}
    ]);
    // pre-existing null placeholders are preserved (defensive, non-destructive)
    expect(out.filter(e => e === null)).toHaveLength(2);
  });

  it('tolerates an UNDEFINED current selection (distinct from null)', () => {
    expect(buildLicensesSelected(undefined, 'compA', 'MIT', 'c'))
      .toEqual([{key: 'compA', license: 'MIT', comment: 'c'}]);
  });

  it('treats a non-array current (string/object junk) as empty', () => {
    expect(buildLicensesSelected('not-an-array', 'compA', 'MIT', 'c'))
      .toEqual([{key: 'compA', license: 'MIT', comment: 'c'}]);
    expect(buildLicensesSelected({not: 'an array'}, 'compA', 'MIT', 'c'))
      .toEqual([{key: 'compA', license: 'MIT', comment: 'c'}]);
  });

  it('carries an undefined comment through without choking (payload shape stable)', () => {
    const out = buildLicensesSelected([], 'compA', 'MIT', undefined);
    expect(out).toEqual([{key: 'compA', comment: undefined, license: 'MIT'}]);
  });

  it('produces the exact updateCollection payload shape {key, license, comment}', () => {
    // Criterion 5: the appended entry is precisely what gets persisted.
    const [entry] = buildLicensesSelected([], 'compA', 'MIT', 'audit');
    expect(Object.keys(entry).sort()).toEqual(['comment', 'key', 'license']);
    expect(entry.key).toBe('compA');
    expect(entry.license).toBe('MIT');
    expect(entry.comment).toBe('audit');
  });

  it('does not mutate the original array even when it contains the clicked key (rollback safety)', () => {
    // originalData is cloned from `current` for rollback; the rebuild must leave
    // the caller's array byte-for-byte intact.
    const current = [
      {key: 'compA', license: 'GPL-2.0', comment: 'old'},
      {key: 'compB', license: 'ISC', comment: 'b'}
    ];
    const snapshot = JSON.parse(JSON.stringify(current));
    const out = buildLicensesSelected(current, 'compA', 'MIT', 'new');
    expect(current).toEqual(snapshot);
    // And the returned array is a different reference (not the same array).
    expect(out).not.toBe(current);
  });
});

describe('#87 modalVisible is instance-scoped, not global (criteria 2/3/4)', () => {
  it('creates a per-instance ReactiveVar for the dialog visibility', () => {
    expect(jsCode).toMatch(/import\s*\{\s*ReactiveVar\s*\}\s*from\s*'meteor\/reactive-var'/);
    expect(jsCode).toMatch(/new ReactiveVar/);
  });

  it('no longer reads or writes the GLOBAL Session modalVisible var', () => {
    expect(jsCode).not.toMatch(/Session\.get\(\s*'modalVisible'/);
    expect(jsCode).not.toMatch(/Session\.set\(\s*'modalVisible'/);
  });

  it('the modalVisible helper reads the template instance var', () => {
    expect(jsCode).toMatch(/modalVisible:\s*function[\s\S]*?Template\.instance\(\)/);
  });
});

describe('#87 clean teardown after close (criteria 7/8)', () => {
  it('removes any leftover backdrop and the modal-open body class on close', () => {
    expect(jsCode).toMatch(/\.modal-backdrop/);
    expect(jsCode).toMatch(/removeClass\(\s*'modal-open'\s*\)/);
  });

  it('clears the instance visibility var on hidden.bs.modal', () => {
    expect(jsCode).toMatch(/hidden\.bs\.modal/);
  });
});

describe('#87 role gating still wraps the whole template (criterion 10)', () => {
  it('keeps the compliance_manager,manager isInRole guard', () => {
    expect(htmlSrc).toMatch(/\{\{#if isInRole 'compliance_manager,manager' companyId\}\}/);
  });
});

describe('#87 no regression in the radio rows (criterion 9)', () => {
  it('renders one radio row per license, pre-checking the selected one', () => {
    expect(htmlSrc).toMatch(/\{\{#each licenses\}\}/);
    expect(htmlSrc).toMatch(/checked="\{\{isSelected\}\}"/);
    expect(jsCode).toMatch(/isSelected:\s*function[\s\S]*?\?\s*'checked'\s*:/);
  });
});

describe('#87 buildLicensesSelected payload (criteria 5/6)', () => {
  it('appends exactly one entry for the clicked component', () => {
    const out = buildLicensesSelected([], 'compA', 'MIT', 'c');
    expect(out).toEqual([{key: 'compA', license: 'MIT', comment: 'c'}]);
  });

  it('replaces the clicked component existing selection (no duplicate key)', () => {
    const current = [{key: 'compA', license: 'GPL-2.0', comment: 'old'}];
    const out = buildLicensesSelected(current, 'compA', 'MIT', 'new');
    expect(out).toEqual([{key: 'compA', license: 'MIT', comment: 'new'}]);
    expect(out.filter(e => e.key === 'compA')).toHaveLength(1);
  });

  it('targets ONLY the clicked component, leaving other components untouched', () => {
    const current = [
      {key: 'compA', license: 'Apache-2.0', comment: 'a'},
      {key: 'compB', license: 'GPL-2.0', comment: 'b'}
    ];
    const out = buildLicensesSelected(current, 'compB', 'MIT', 'b2');
    expect(out).toContainEqual({key: 'compA', license: 'Apache-2.0', comment: 'a'});
    expect(out).toContainEqual({key: 'compB', license: 'MIT', comment: 'b2'});
    expect(out).toHaveLength(2);
  });

  it('does not mutate the original array (originalData stays intact for rollback)', () => {
    const current = [{key: 'compA', license: 'GPL-2.0', comment: 'old'}];
    const snapshot = JSON.parse(JSON.stringify(current));
    buildLicensesSelected(current, 'compA', 'MIT', 'new');
    expect(current).toEqual(snapshot);
  });

  it('tolerates a null/undefined current selection', () => {
    expect(buildLicensesSelected(null, 'compA', 'MIT', 'c'))
      .toEqual([{key: 'compA', license: 'MIT', comment: 'c'}]);
  });
});

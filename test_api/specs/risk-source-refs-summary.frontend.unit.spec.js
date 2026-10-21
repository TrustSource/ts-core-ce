/* eslint-disable no-undef */
// Unit tests for the PURE source-reference derivations that back the
// auto-created-risk provenance strip and the "Source references" tab in
// imports/client/ui/common/risk-edit/risk-edit.js:
//   countSourceRefs(entries)                    -> {findings, files, rules, shown}
//   pluralizeCount(count, noun)                 -> '1 file' / '3 files'
//   summarizeSourceRefs(entries, total, trunc)  -> the whole counts line
//   decorateSourceRefs(entries, levelLabels)    -> rows the reactiveTable renders
//
// WHY this is a vm-sandbox extraction and not a plain `require(...)`: risk-edit.js
// imports 'meteor/templating', 'meteor/meteor', jQuery and /imports/lib/sarif/
// cweRiskPlan, and uses ES import/export syntax; jest.config.js registers no babel
// transform and there is no Blaze/jsdom render harness in this repo. Same reason
// and same technique as project-settings-architecture-upload.frontend.unit.spec.js:
// the REAL function source is extracted verbatim and executed, so these tests
// exercise the shipped logic (pluralisation, truncation wording, prototype-key
// safety) rather than a retyped copy. If a function is renamed or restructured the
// extraction throws immediately and the whole file fails loudly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '../../imports/client/ui/common/risk-edit/risk-edit.js');
const raw = fs.readFileSync(SRC_PATH, 'utf8');

function must(match, label) {
  if (!match) {
    throw new Error('risk-source-refs-summary.frontend.unit.spec.js: could not locate ' + label +
      ' in risk-edit.js - has it been renamed or restructured?');
  }
  return match;
}

function fnSrc(name) {
  return must(raw.match(new RegExp('export function ' + name + '\\([\\s\\S]*?\\n\\}')), name)[0]
    .replace('export ', '');
}

// Pulled from the real source rather than retyped, so the spec cannot drift from
// the literal the UI actually renders for a finding with no resolvable path.
const noFileLabelExpr = must(raw.match(/const NO_FILE_LABEL\s*=\s*(.+?)\n/), 'NO_FILE_LABEL')[1].replace(/;?\s*$/, '');

const sandboxSrc = `
  const NO_FILE_LABEL = ${noFileLabelExpr};
  ${fnSrc('countSourceRefs')}
  ${fnSrc('pluralizeCount')}
  ${fnSrc('summarizeSourceRefs')}
  ${fnSrc('decorateSourceRefs')}
  module.exports = {countSourceRefs, pluralizeCount, summarizeSourceRefs, decorateSourceRefs};
`;

const sandbox = {module: {exports: {}}, exports: {}};
vm.createContext(sandbox);
vm.runInContext(sandboxSrc, sandbox, {filename: SRC_PATH});

const {countSourceRefs, pluralizeCount, summarizeSourceRefs, decorateSourceRefs} = sandbox.module.exports;

// Mirrors SOURCE_REF_LEVEL_LABEL in imports/lib/sarif/cweRiskPlan.js (Interface
// Contract section A). Passed in as an argument so the derivations stay pure.
const LABELS = {error: 'violation', warning: 'warning', note: 'note'};

function entry(ruleId, uri, level, count) {
  return {tool: 'semgrep', ruleId: ruleId, uri: uri, level: level, count: count};
}

describe('#129 countSourceRefs - live counts derived from sourceRefs', () => {
  it('returns all-zero counts for an empty list', () => {
    expect(countSourceRefs([])).toEqual({findings: 0, files: 0, rules: 0, shown: 0});
  });

  it('returns all-zero counts when sourceRefs is absent (cold load / never populated)', () => {
    expect(countSourceRefs(undefined)).toEqual({findings: 0, files: 0, rules: 0, shown: 0});
    expect(countSourceRefs(null)).toEqual({findings: 0, files: 0, rules: 0, shown: 0});
  });

  it('sums count across entries and counts distinct files and rules', () => {
    const refs = [
      entry('r.one', 'src/a.js', 'error', 5),
      entry('r.one', 'src/b.js', 'error', 4),
      entry('r.two', 'src/a.js', 'warning', 3),
      entry('r.three', 'src/c.js', 'note', 2)
    ];
    expect(countSourceRefs(refs)).toEqual({findings: 14, files: 3, rules: 3, shown: 4});
  });

  it('counts an entry with no resolvable path (uri: "") toward findings but not files (AC10)', () => {
    const refs = [entry('r.one', '', 'error', 7), entry('r.one', 'src/a.js', 'error', 1)];
    expect(countSourceRefs(refs)).toEqual({findings: 8, files: 1, rules: 1, shown: 2});
  });

  it('does not blow up on a non-numeric count', () => {
    expect(countSourceRefs([entry('r', 'a', 'error', undefined)]).findings).toBe(0);
    expect(countSourceRefs([entry('r', 'a', 'error', '3')]).findings).toBe(3);
  });

  it('tolerates a null hole in the array', () => {
    expect(countSourceRefs([null, entry('r', 'a', 'error', 2)]))
      .toEqual({findings: 2, files: 1, rules: 1, shown: 2});
  });

  // uri and ruleId come straight out of an uploaded SARIF document; a plain
  // object literal would swallow '__proto__' as a prototype assignment and
  // silently undercount.
  it('counts a file literally named __proto__ or constructor', () => {
    const refs = [
      entry('__proto__', '__proto__', 'error', 1),
      entry('constructor', 'constructor', 'error', 1)
    ];
    expect(countSourceRefs(refs)).toEqual({findings: 2, files: 2, rules: 2, shown: 2});
  });
});

describe('#129 pluralizeCount', () => {
  it('uses the singular for exactly one', () => {
    expect(pluralizeCount(1, 'file')).toBe('1 file');
  });

  it('uses the plural for zero', () => {
    expect(pluralizeCount(0, 'file')).toBe('0 files');
  });

  it('uses the plural for many', () => {
    expect(pluralizeCount(12, 'occurrence')).toBe('12 occurrences');
  });
});

describe('#129 summarizeSourceRefs - the provenance strip counts line', () => {
  const refs = [
    entry('r.one', 'src/a.js', 'error', 5),
    entry('r.one', 'src/b.js', 'error', 4),
    entry('r.two', 'src/a.js', 'warning', 3),
    entry('r.three', 'src/c.js', 'note', 2)
  ];

  it('renders findings, files, rules and occurrences separated by middots', () => {
    expect(summarizeSourceRefs(refs, 4, false))
      .toBe('14 findings · 3 files · 3 rules · 4 occurrences');
  });

  it('pluralises every noun independently (the all-singular case)', () => {
    expect(summarizeSourceRefs([entry('r.one', 'src/a.js', 'error', 1)], 1, false))
      .toBe('1 finding · 1 file · 1 rule · 1 occurrence');
  });

  // AC12: the strip's own counts are derived from the CAPPED list, so it must say
  // so rather than presenting an understated total as the whole truth.
  it('discloses the cap when the stored list is truncated (AC12)', () => {
    expect(summarizeSourceRefs(refs, 3241, true))
      .toBe('14 findings · 3 files · 3 rules · counted from the first 4 of 3241 occurrences');
  });

  it('never claims occurrences it does not have when the list is empty', () => {
    expect(summarizeSourceRefs([], 0, false))
      .toBe('0 findings · 0 files · 0 rules · 0 occurrences');
  });
});

describe('#129 decorateSourceRefs - rows handed to the reactiveTable', () => {
  it('adds uriLabel and levelLabel without mutating the stored entries', () => {
    const stored = [entry('r.one', 'src/a.js', 'error', 5)];
    const rows = decorateSourceRefs(stored, LABELS);
    expect(rows[0]).toEqual({
      tool: 'semgrep', ruleId: 'r.one', uri: 'src/a.js', uriLabel: 'src/a.js',
      level: 'error', levelLabel: 'violation', count: 5
    });
    expect(stored[0].uriLabel).toBeUndefined();
    expect(stored[0].levelLabel).toBeUndefined();
    expect(rows[0]).not.toBe(stored[0]);
  });

  it('renders the literal "(no file)" for an entry with no resolvable path', () => {
    const rows = decorateSourceRefs([entry('r.one', '', 'warning', 2)], LABELS);
    expect(rows[0].uri).toBe('');
    expect(rows[0].uriLabel).toBe('(no file)');
    expect(rows[0].levelLabel).toBe('warning');
  });

  it('labels a note level with its own word', () => {
    expect(decorateSourceRefs([entry('r', 'a', 'note', 1)], LABELS)[0].levelLabel).toBe('note');
  });

  it('returns an empty array for absent sourceRefs', () => {
    expect(decorateSourceRefs(undefined, LABELS)).toEqual([]);
    expect(decorateSourceRefs(null, LABELS)).toEqual([]);
  });

  // A level of 'constructor' must not resolve through the prototype chain and
  // put a Function object into the table cell.
  it('falls back to the raw level rather than an inherited prototype member', () => {
    const rows = decorateSourceRefs([entry('r', 'a', 'constructor', 1)], LABELS);
    expect(rows[0].levelLabel).toBe('constructor');
    expect(typeof rows[0].levelLabel).toBe('string');
  });

  it('never emits undefined into a cell for a malformed entry', () => {
    const rows = decorateSourceRefs([{}], LABELS);
    expect(rows[0]).toEqual({
      tool: '', ruleId: '', uri: '', uriLabel: '(no file)', level: '', levelLabel: '', count: 0
    });
  });
});

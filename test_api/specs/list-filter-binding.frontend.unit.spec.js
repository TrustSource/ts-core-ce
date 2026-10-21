/* eslint-disable no-undef */
// The list-filter search box must react to TYPING, not only to blur.
//
// `'change input[name="search"]'` looks equivalent to `'keyup ...'` when you read it, and it
// is not: a `change` event on a text input fires only when the field loses focus (or the user
// presses Enter). A filter bound that way looks broken to anyone who types a term and waits -
// the table does not move until they click away. That is exactly how it was reported here.
//
// The repo already had both spellings side by side (`license-list` on `keyup`, `project-list`
// on `change`), so this is a consistency guard as much as a regression guard: it pins the
// event NAME in the source rather than any rendered behaviour, because Blaze rendering is out
// of reach for this harness.
//
// Each entry is a file whose filter box the user drives directly from a list page.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');

// Filter bars the user types into, keyed by the template file that binds the handler.
const TYPE_AHEAD_FILTERS = {
  'project list': 'imports/client/ui/project/project-list.js',
  'license list': 'imports/client/ui/license/license-list.js',
  'license detail': 'imports/client/ui/license/license-detail.js'
};

const SEARCH_BINDING = /'(keyup|change|input|blur)\s+input\[name="search"\]'/g;

function readSource(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

describe('list filter boxes react to typing, not only to blur', () => {
  Object.entries(TYPE_AHEAD_FILTERS).forEach(([label, relPath]) => {
    it(`${label} binds its search box on a typing event`, () => {
      const src = readSource(relPath);
      const bindings = [...src.matchAll(SEARCH_BINDING)].map((m) => m[1]);

      // Guards the guard: if the selector is ever renamed, this spec must fail loudly rather
      // than pass over a file it no longer matches.
      expect(bindings.length).toBeGreaterThan(0);

      // `change` fires on blur only. `keyup`/`input` fire as the user types.
      expect(bindings).not.toContain('change');
    });
  });

  it('throttles the handler, so typing does not fire a route change per keystroke', () => {
    // Every one of these handlers calls Router.go(); unthrottled that is one history entry
    // per character. The working reference (license-list) throttles at 400ms.
    // Anchor on the EVENT BINDING, not on the first mention of the selector: the template
    // also reads that input by name elsewhere (onRendered restores its value), and slicing
    // from the first occurrence silently measured the wrong lines.
    const src = readSource(TYPE_AHEAD_FILTERS['project list']);
    const binding = src.match(/'(?:keyup|input)\s+input\[name="search"\]':\s*([\s\S]{0,80})/);
    expect(binding).not.toBeNull();
    expect(binding[1]).toMatch(/_\.throttle\(/);
  });
});

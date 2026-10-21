/* eslint-disable no-undef */
// Tasks panel actions - "Copy details" and "Create issue" on the module
// component / license / dependency-aside panels.
//
// Four separate breakages were fixed together here:
//
//   1. Every unconfigured integration partial (jiraLink, tfsLink,
//      githubIssuesLink) rendered its OWN "Copy details" link, so a panel with
//      two unconfigured integrations showed the same link twice. The link is
//      generic - it only needs the description - so it moved to a shared
//      `copyIssueDetails` template rendered once per panel.
//   2. Each of those partials also did `new Clipboard('.copy-information')` in
//      onCreated. clipboard.js registers a DELEGATED listener on document.body
//      and nothing ever destroyed it, so every re-render stacked another
//      handler on the same links. The shared template uses the static
//      `Clipboard.copy()` from its own Blaze event handler instead.
//   3. The action anchors carried a bare `href` attribute. In Blaze that emits
//      `href=""`, which the browser resolves to the current URL - clicking
//      "Copy details" or "Create issue" reloaded the whole SPA and swallowed
//      the action. The attribute is gone. An <a> without an href is not a link
//      though, so the anchors are marked role="button" tabindex="0" and depend
//      on common/keyboard-activate.js for Enter/Space and on a `cursor: pointer`
//      rule to still look clickable.
//   4. Announcing "Information was successfully copied" straight after
//      `Clipboard.copy()`, which reports nothing about whether the copy
//      happened. The toast is gated on an observed outcome now.
//
// Plus the modal lookup: `$(event.target).parent().find('.createIssue')` only
// worked when the click landed on the <a> itself. Clicking the icon <span>
// inside it made event.target the span, .parent() the <a>, and .find() came
// back empty - so "Create issue" did nothing. It is now resolved from
// event.currentTarget's siblings, which is only correct while the modal really
// IS a sibling of the trigger; that structure is asserted below.
//
// WHY source/markup pattern matching (same rationale as the sibling *.unit
// specs in this dir): these are Blaze templates that import meteor/* and cannot
// be loaded under jest. The claims that can be executed against the installed
// dependency - that clipboard exposes the static this code calls, and that its
// copy() reports nothing about the outcome - ARE executed.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

function abs(rel) {
  return path.join(REPO, rel);
}

function raw(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

// Comment-aware: a match against source must not false-pass on a commented-out
// line, and every one of these files carries long explanatory comments that name
// the very identifiers being asserted.
function code(rel) {
  return raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function markup(rel) {
  return raw(rel).replace(/<!--[\s\S]*?-->/g, '');
}

const COPY_HTML = 'imports/client/ui/common/copy-issue-details.html';
const COPY_JS = 'imports/client/ui/common/copy-issue-details.js';
const COMMON_INDEX = 'imports/client/ui/common/index.js';
const LEANIX_LESS = 'imports/client/stylesheets/common/leanix.less';
const STYLE_LESS = 'imports/client/stylesheets/style.less';
const COMPONENT_JS = 'imports/lib/component/Component.js';

// The three partials a Tasks panel renders side by side.
const INTEGRATION_PARTIALS = [
  'imports/client/ui/common/jira.html',
  'imports/client/ui/common/tfs-link.html',
  'imports/client/ui/common/github-issues.html'
];

// The five templates that own a "Create issue" modal.
const MODAL_TEMPLATES = [
  ['imports/client/ui/common/jira.html', 'imports/client/ui/common/jira.js', 'show-jira-modal'],
  ['imports/client/ui/common/tfs-link.html', 'imports/client/ui/common/tfs-link.js', 'show-tfs-modal'],
  ['imports/client/ui/common/github-issues.html', 'imports/client/ui/common/github-issues.js', 'show-github-modal'],
  ['imports/client/ui/common/algorithms-issues-link/algorithms-issues-link.html',
    'imports/client/ui/common/algorithms-issues-link/algorithms-issues-link.js', 'show-github-modal'],
  ['imports/client/ui/common/risk-issues-link/risk-issues-link.html',
    'imports/client/ui/common/risk-issues-link/risk-issues-link.js', 'show-github-modal']
];

// The three Create issue triggers a Tasks panel renders next to each other, with
// the accessible name each one has to carry.
const CREATE_ISSUE_TRIGGERS = [
  ['imports/client/ui/common/jira.html', 'show-jira-modal', 'Create issue in Jira'],
  ['imports/client/ui/common/tfs-link.html', 'show-tfs-modal', 'Create issue in TFS'],
  ['imports/client/ui/common/github-issues.html', 'show-github-modal', 'Create issue in GitHub']
];

// The three panels that render the shared Copy details link.
const TASKS_PANELS = [
  'imports/client/ui/module/module-details/module-detail-component.html',
  'imports/client/ui/module/module-details/module-detail-license.html',
  'imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.html'
];

// The two helpers that build the description the panel hands to those partials.
const PROBLEM_DESCRIPTION_HELPERS = [
  'imports/client/ui/module/module-details/module-detail-component.js',
  'imports/client/ui/module/module-details/module-dependencies/module-dependencies-aside.js'
];

// ...plus the license variant, which builds the same kind of text for a license
// rather than a component.
const LICENSE_JS = 'imports/client/ui/module/module-details/module-detail-license.js';
const TEXT_BUILDERS = PROBLEM_DESCRIPTION_HELPERS.concat([LICENSE_JS]);

const ACTIVATE_JS = 'imports/client/ui/common/keyboard-activate.js';

// Every template that owns one of the hrefless action anchors.
const ANCHOR_TEMPLATES = MODAL_TEMPLATES.map((entry) => entry[0]).concat([COPY_HTML]);

function anchors(file) {
  return markup(file).match(/<a\b[^>]*>/g) || [];
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

describe('the shared Copy details template is reachable at runtime', () => {
  it('declares the template the panels render', () => {
    expect(markup(COPY_HTML)).toMatch(/<template name="copyIssueDetails">/);
    expect(code(COPY_JS)).toMatch(/Template\.copyIssueDetails\.events\(/);
  });

  it('is imported into the client bundle, markup AND logic', () => {
    // Blaze throws "No such template: copyIssueDetails" if the .html is not
    // imported, and the link silently does nothing if only the .html is.
    const index = code(COMMON_INDEX);
    expect(index).toMatch(/import '\.\/copy-issue-details\.html';/);
    expect(index).toMatch(/import '\.\/copy-issue-details';/);
  });

  it('renders nothing when there is no description to copy', () => {
    // A panel with no problem description must not offer a dead copy link.
    expect(markup(COPY_HTML)).toMatch(/\{\{#if description\.text\}\}/);
    expect(code(COPY_JS)).toMatch(/if \(!text\) return;/);
  });
});

describe('the clipboard API the shared template depends on', () => {
  // The only executable contract in this spec: if a dependency bump drops the
  // static, `Clipboard.copy(...)` becomes a TypeError at click time and the
  // Copy details link breaks silently in the browser.
  const pkg = require(abs('node_modules/clipboard/package.json'));
  const entry = require(abs(path.join('node_modules/clipboard', pkg.main)));

  it('resolves the same entry point Meteor loads', () => {
    // Meteor ignores package.json "exports" and follows "main"; assert the file
    // this test loaded is that one, so a passing test says something about the
    // bundle rather than about node resolution.
    expect(pkg.exports).toBeUndefined();
    expect(pkg.main).toBe('dist/clipboard.js');
  });

  it('exposes a static copy() for the shared template', () => {
    expect(typeof entry.copy).toBe('function');
  });

  it('is still the constructor the other 20-odd call sites use', () => {
    // Both directions: dropping `new Clipboard(selector)` support would break
    // every other copy button in the app, not just this one.
    expect(typeof entry).toBe('function');
    expect(typeof entry.prototype.destroy).toBe('function');
  });

  it('the shared template uses the static and never registers a delegated listener', () => {
    const src = code(COPY_JS);
    expect(src).toMatch(/Clipboard\.copy\(text\)/);
    // Non-vacuity: the leaking per-render constructor must not be back.
    expect(src).not.toMatch(/new Clipboard\(/);
  });

  it('no integration partial constructs a document-wide clipboard any more', () => {
    // These three used to stack a body-delegated handler on every re-render.
    expect(code('imports/client/ui/common/jira.js')).not.toMatch(/new Clipboard\(/);
    expect(code('imports/client/ui/common/tfs-link.js')).not.toMatch(/new Clipboard\(/);
    expect(code('imports/client/ui/common/github-issues.js')).not.toMatch(/new Clipboard\(/);
  });
});

describe('exactly one Copy details affordance per Tasks panel', () => {
  it.each(INTEGRATION_PARTIALS)('%s no longer renders its own copy link', (file) => {
    const html = markup(file);
    expect(html).not.toMatch(/copy-information/);
    expect(html).not.toMatch(/Copy details/);
  });

  it.each(INTEGRATION_PARTIALS)('%s still renders its Create issue affordance', (file) => {
    // Both directions: the copy link was removed, the integration was not.
    expect(markup(file)).toMatch(/class="show-(jira|tfs|github)-modal"/);
  });

  it.each(TASKS_PANELS)('%s includes the shared copy link exactly once', (file) => {
    expect(count(markup(file), '{{> copyIssueDetails')).toBe(1);
  });

  it.each(TASKS_PANELS)('%s still renders the integration partials', (file) => {
    const html = markup(file);
    expect(html).toMatch(/\{\{> jiraLink /);
    expect(html).toMatch(/\{\{> tfsLink /);
  });

  it('never renders the shared link beside a partial that kept its own', () => {
    // riskIssuesLink and algorithmsIssuesLink legitimately still carry a
    // .copy-information link (they are used on pages of their own, not in a
    // Tasks panel). Putting one next to copyIssueDetails would bring the
    // duplicate straight back.
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (name.endsWith('.html')) {
          const html = fs.readFileSync(full, 'utf8');
          if (html.includes('{{> copyIssueDetails') &&
            /\{\{> (riskIssuesLink|algorithmsIssuesLink)/.test(html)) {
            offenders.push(path.relative(REPO, full));
          }
        }
      }
    };
    walk(abs('imports/client/ui'));
    expect(offenders).toEqual([]);
  });
});

describe('Create issue opens its modal from any click target', () => {
  it.each(MODAL_TEMPLATES)('%s resolves the modal from event.currentTarget', (html, js) => {
    const src = code(js);
    expect(src).toMatch(/\$\(event\.currentTarget\)\.siblings\('\.createIssue'\)/);
    // Non-vacuity: the lookup that missed whenever the icon span was clicked.
    expect(src).not.toMatch(/\$\(event\.target\)\.parent\(\)\.find\('\.createIssue'\)/);
  });

  it('the old modal lookup survives nowhere in the client tree', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (name.endsWith('.js')) {
          if (/\$\(event\.target\)\.parent\(\)\.find\('\.createIssue'\)/
            .test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(REPO, full));
          }
        }
      }
    };
    walk(abs('imports/client/ui'));
    expect(offenders).toEqual([]);
  });

  // `siblings()` is only the right lookup while the modal really is a sibling of
  // its trigger. Wrapping the modal in one extra element would silently break
  // every Create issue button, and nothing else in the codebase would complain.
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

  function tagBalance(fragment) {
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
    let depth = 0;
    let min = 0;
    let match;
    while ((match = re.exec(fragment)) !== null) {
      const name = match[2].toLowerCase();
      const selfClosing = /\/\s*$/.test(match[3]);
      if (VOID_TAGS.has(name) || selfClosing) continue;
      depth += match[1] === '/' ? -1 : 1;
      if (depth < min) min = depth;
    }
    return {depth, min};
  }

  it.each(MODAL_TEMPLATES)('%s keeps .createIssue a sibling of the trigger', (html, js, trigger) => {
    // Blaze block helpers are stripped: both branches of an {{#if}} are balanced
    // markup here, so what is left parses as ordinary HTML.
    const source = markup(html).replace(/\{\{[^}]*\}\}/g, '');
    const triggerAt = source.indexOf('<a class="' + trigger + '"');
    const modalAt = source.indexOf('createIssue"');
    expect(triggerAt).toBeGreaterThan(-1);
    expect(modalAt).toBeGreaterThan(triggerAt);
    // Every element opened after the trigger is closed again before the modal
    // (depth 0) and nothing enclosing them both is closed in between (min 0):
    // that is exactly what makes them siblings.
    expect(tagBalance(source.slice(triggerAt, modalAt))).toEqual({depth: 0, min: 0});
  });
});

describe('action anchors are buttons: no bare href, still clickable', () => {
  it.each(ANCHOR_TEMPLATES)('%s emits no bare href', (file) => {
    // Blaze turns a bare `href` into href="" - a link back to the current URL,
    // which reloaded the SPA and cancelled the click handler.
    const bare = anchors(file).filter((tag) => /\bhref(?!\s*=)/.test(tag));
    expect(bare).toEqual([]);
  });

  it('real navigation links kept their href', () => {
    // Both directions: the sweep above must not have passed by deleting hrefs
    // from the anchors that genuinely navigate somewhere.
    expect(markup('imports/client/ui/common/github-issues.html'))
      .toMatch(/<a class="view-github" href="\{\{githubApp\}\}\{\{githubId\}\}"/);
    expect(markup('imports/client/ui/common/jira.html'))
      .toMatch(/<a class="view-jira"[^>]*href="/);
    expect(markup('imports/client/ui/common/tfs-link.html'))
      .toMatch(/<a class="view-tfs" href="/);
  });

  it('every hrefless anchor is covered by a cursor:pointer rule', () => {
    // With the href gone the browser stops showing a pointer, so the rule in
    // leanix.less is now load-bearing UI, not decoration.
    const less = raw(LEANIX_LESS);
    const block = less.match(/((?:a\.[a-z0-9-]+,\s*)+a\.[a-z0-9-]+)\s*\{\s*cursor:\s*pointer;/i);
    expect(block).not.toBeNull();
    const covered = new Set((block[1].match(/a\.([a-z0-9-]+)/gi) || [])
      .map((sel) => sel.slice(2)));

    const uncovered = [];
    for (const file of ANCHOR_TEMPLATES) {
      for (const tag of anchors(file)) {
        if (/\bhref\s*=/.test(tag)) continue;
        const classAttr = tag.match(/class="([^"]*)"/);
        const classes = classAttr ? classAttr[1].split(/\s+/).filter(Boolean) : [];
        if (!classes.some((cls) => covered.has(cls))) {
          uncovered.push(path.basename(file) + ': ' + tag);
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('the stylesheet carrying that rule is actually imported', () => {
    // A rule in an unimported .less file styles nothing.
    expect(raw(STYLE_LESS)).toMatch(/@import "common\/leanix\.less";/);
  });
});

describe('the problem description falls back to the component key', () => {
  it.each(PROBLEM_DESCRIPTION_HELPERS)('%s resolves a name via getName()', (file) => {
    const src = code(file);
    expect(src).toMatch(/component\.getName \? component\.getName\(\)/);
    expect(src).toMatch(/item\.name \|\| item\.key/);
    expect(src).toMatch(/if \(item && name\)/);
  });

  it.each(PROBLEM_DESCRIPTION_HELPERS)('%s no longer gates on item.name', (file) => {
    const src = code(file);
    // Non-vacuity: the gate that left `description` undefined - which emptied
    // the clipboard text and made Create issue throw on this.description.title.
    expect(src).not.toMatch(/if \(item && item\.name\)/);
    // ...nor is the raw name still interpolated into the text it builds.
    expect(src).not.toMatch(/Component "'\+ item\.name \+'"/);
    expect(src).not.toMatch(/title: item\.name\+'/);
  });

  it('Component.getName() is what makes that fallback work', () => {
    // Cross-file invariant: the helpers above delegate to getName() and only
    // fall back to item.key when the object is not a Component. If getName ever
    // stopped covering the key, scanned components would go nameless again with
    // nothing else failing.
    expect(code(COMPONENT_JS))
      .toMatch(/Component\.prototype\.getName = function getName\(\) \{\s*return this\.data\(\)\.name \|\| this\.data\(\)\.key;/);
  });
});

describe('the action anchors are keyboard operable and named', () => {
  // Dropping the bare href fixed the SPA reload but took the anchors out of the
  // tab order and stripped their link role, leaving them mouse-only. They act
  // like buttons, so they are marked as buttons.
  it.each(ANCHOR_TEMPLATES)('%s marks every hrefless anchor role=button, tabindex=0', (file) => {
    const unreachable = [];
    for (const tag of anchors(file)) {
      if (/\bhref\s*=/.test(tag)) continue;
      if (!/\brole="button"/.test(tag) || !/\btabindex="0"/.test(tag)) {
        unreachable.push(tag);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it('there really are hrefless anchors for that sweep to check', () => {
    // Non-vacuity: the assertion above passes trivially if every anchor kept an
    // href, which is exactly the bug it is guarding against.
    const hrefless = ANCHOR_TEMPLATES.reduce((total, file) => {
      return total + anchors(file).filter((tag) => !/\bhref\s*=/.test(tag)).length;
    }, 0);
    expect(hrefless).toBeGreaterThanOrEqual(11);
  });

  it('the icon-only remove crosses carry an accessible name', () => {
    // <a class="fa fa-remove"> draws its glyph from a CSS pseudo-element, so
    // there is no text content for a screen reader to announce.
    const unnamed = [];
    let seen = 0;
    for (const file of ANCHOR_TEMPLATES) {
      for (const tag of anchors(file)) {
        if (!/\bfa-remove\b/.test(tag)) continue;
        seen += 1;
        if (!/\baria-label="[^"]+"/.test(tag)) {
          unnamed.push(path.basename(file) + ': ' + tag);
        }
      }
    }
    expect(unnamed).toEqual([]);
    // Jira, TFS, GitHub and the risk variant.
    expect(seen).toBe(4);
  });

  it('the three Create issue triggers do not all announce the same name', () => {
    // A dependency Tasks panel renders all three side by side and the only text
    // in each is "Create issue", so a screen-reader user tabbed through three
    // controls announced identically - the defect the remove crosses were fixed
    // for one bullet earlier.
    const names = CREATE_ISSUE_TRIGGERS.map(([file, cls, expected]) => {
      const tag = anchors(file).find((candidate) => candidate.includes('class="' + cls + '"'));
      expect(tag).toBeDefined();
      expect(tag).toContain('aria-label="' + expected + '"');
      return expected;
    });
    expect(new Set(names).size).toBe(CREATE_ISSUE_TRIGGERS.length);
  });

  it('their visible text really is identical, which is what makes the name load-bearing', () => {
    // Non-vacuity for the assertion above: if the labels ever differed on screen,
    // the aria-label would be redundant rather than the only thing telling the
    // three apart.
    for (const [file] of CREATE_ISSUE_TRIGGERS) {
      expect(markup(file)).toMatch(/>\s*Create issue\s*<\/a>/);
    }
  });

  it('Enter and Space activate them', () => {
    const src = code(ACTIVATE_JS);
    expect(src).toMatch(/const ACTIVATABLE = 'a\[role="button"\]:not\(\[href\]\)';/);
    expect(src).toMatch(/'Enter'/);
    expect(src).toMatch(/' '/);
    expect(src).toMatch(/event\.preventDefault\(\)/);
    // The native click reaches Blaze's jQuery-delegated handlers AND
    // clipboard.js's own native listener, each exactly once.
    expect(src).toMatch(/event\.currentTarget\.click\(\)/);
  });

  // The delegated selector matches .remove-jira / .remove-tfs / .remove-github,
  // whose handlers call a server method that DELETES the linked remote issue. A
  // key held down repeats keydown at the OS auto-repeat rate, so the handler has
  // to behave the way a native button does rather than fire per tick.
  function handlerBodies() {
    const bodies = code(ACTIVATE_JS).split(/\.on\(/).slice(1);
    expect(bodies.length).toBe(2);
    return bodies;
  }

  it('binds keydown and keyup to the same anchors', () => {
    const [down, up] = handlerBodies();
    expect(down).toMatch(/^'keydown', ACTIVATABLE,/);
    expect(up).toMatch(/^'keyup', ACTIVATABLE,/);
  });

  it('a held key cannot fire one activation per repeat tick', () => {
    const src = code(ACTIVATE_JS);
    expect(src).toMatch(/\.repeat/);
    // ...and the guard is consulted before either handler can click.
    for (const body of handlerBodies()) {
      const guarded = body.indexOf('ignore(event)');
      const clicked = body.indexOf('.click()');
      expect(guarded).toBeGreaterThan(-1);
      expect(clicked).toBeGreaterThan(guarded);
    }
  });

  it('reads repeat off the native event, because jQuery does not proxy it', () => {
    // Executable cross-dependency check, the same one the spec makes for
    // event.key just above - with the opposite answer. jQuery.event.addProp is
    // given an explicit property list, and `repeat` is not on it, so a jQuery
    // event's `repeat` is undefined however hard the user leans on the key. A
    // guard written as `event.repeat` is dead code that always passes.
    const jq = raw('node_modules/jquery/dist/jquery.js');
    const block = jq.match(/jQuery\.each\(\s*\{[\s\S]{0,1200}?\},\s*jQuery\.event\.addProp\s*\)/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/(^|\s)key:\s*true/m);
    expect(block[0]).not.toMatch(/(^|\s)repeat:\s*true/m);

    const src = code(ACTIVATE_JS);
    expect(src).toMatch(/event\.originalEvent \|\| event/);
    expect(src).toMatch(/native\.repeat/);
    // Non-vacuity: the guard that reads through jQuery and never fires.
    expect(src).not.toMatch(/\bevent\.repeat\b/);
  });

  it('Space activates on keyup, and its keydown only stops the page scrolling', () => {
    const [down, up] = handlerBodies();
    // keydown swallows Space (otherwise the page scrolls) but does not activate.
    expect(down).toMatch(/if \(isSpace\(event\)\) \{[^}]*event\.preventDefault\(\);\s*return;/);
    // ...and nothing between entering that branch and leaving it activates.
    const branchAt = down.indexOf('if (isSpace(event))');
    expect(branchAt).toBeGreaterThan(-1);
    const branch = down.slice(branchAt);
    expect(branch.slice(0, branch.indexOf('return;'))).not.toContain('.click()');
    expect(down).toMatch(/event\.key !== 'Enter'/);
    expect(up).toMatch(/isSpace\(event\)/);
    // Non-vacuity: the single keydown handler that clicked on Space too.
    expect(code(ACTIVATE_JS)).not.toMatch(/ACTIVATION_KEYS/);
  });

  it('a Space keyup only activates the control its keydown started on', () => {
    // Otherwise a key held down over the page and released after the focus has
    // moved activates whatever it lands on - and what it can land on here
    // includes the crosses that delete a remote issue. A native button pairs the
    // two halves of the press; nothing does that for us.
    const [down, up] = handlerBodies();
    expect(down).toMatch(/spacePressedOn = event\.currentTarget;/);
    expect(up).toMatch(/spacePressedOn = null;/);
    expect(up).toMatch(/pressedOn !== event\.currentTarget/);
    const paired = up.indexOf('pressedOn !== event.currentTarget');
    expect(paired).toBeGreaterThan(-1);
    expect(up.indexOf('.click()')).toBeGreaterThan(paired);
  });

  it('keeps its hands off a field the user is typing in', () => {
    // The handler is registered on the whole document, so it has to stay inert
    // for anything that consumes Enter or Space itself as more templates opt in.
    const src = code(ACTIVATE_JS);
    expect(src).toMatch(/input, textarea, select, \[contenteditable\]/);
    expect(src).toMatch(/\$\(event\.target\)\.closest\(TEXT_ENTRY\)/);
    // contenteditable="false" is not an editing host - it must not disable the
    // activation of an anchor that happens to carry it.
    expect(src).toMatch(/\[contenteditable="false"\]/);
  });

  it('the installed jQuery really exposes the event.key that reads', () => {
    // Executable cross-dependency check: jQuery only proxies the DOM properties
    // it lists for addProp. If a downgrade dropped `key`, the handler above would
    // compare undefined against 'Enter' and every one of these controls would go
    // back to being mouse-only, with nothing else failing.
    const jq = raw('node_modules/jquery/dist/jquery.js');
    const block = jq.match(/jQuery\.each\(\s*\{[\s\S]{0,1200}?\},\s*jQuery\.event\.addProp\s*\)/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/(^|\s)key:\s*true/m);
  });

  it('that handler is registered once, not per render', () => {
    // A listener created in an onCreated is what made the old
    // `new Clipboard('.copy-information')` stack a handler on every re-render.
    expect(code(ACTIVATE_JS)).toMatch(/Meteor\.startup\(/);
    expect(code(COMMON_INDEX)).toMatch(/import '\.\/keyboard-activate';/);
  });

  it('the emailed-Jira status read-out is not dressed up as a control', () => {
    // It has no click handler anywhere, so role="button" would have put a dead
    // stop in the tab order. It was only ever an <a> because of the bare href.
    const jiraHtml = markup('imports/client/ui/common/jira.html');
    expect(jiraHtml).toMatch(/<span class="view-jira">/);
    expect(jiraHtml).not.toMatch(/<a class="view-jira">/);
    // Cross-check the premise: nothing in the client tree handles a click on it.
    const handlers = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.js') && /['"][^'"]*\.view-jira/.test(fs.readFileSync(full, 'utf8'))) {
          handlers.push(path.relative(REPO, full));
        }
      }
    };
    walk(abs('imports/client/ui'));
    expect(handlers).toEqual([]);
  });
});

describe('the copy result is reported, not assumed', () => {
  it('clipboard.js hands back no success signal to gate on', () => {
    // The executable premise for using navigator.clipboard instead: the static
    // copy() returns the text it SELECTED, and the boolean
    // document.execCommand('copy') gives back is discarded one line above the
    // return. Announcing success off the back of that call asserts an outcome
    // nobody observed - the same defect the API key copy button was fixed for.
    const dist = raw('node_modules/clipboard/dist/clipboard.js');
    expect(dist).toMatch(
      /var fakeCopyAction = function fakeCopyAction\(value, options\) \{[\s\S]*?command\('copy'\);[\s\S]*?return selectedText;/);
  });

  it('gates the success toast on navigator.clipboard resolving', () => {
    const src = code(COPY_JS);
    expect(src).toMatch(/navigator\.clipboard\.writeText\(text\)\s*\.then\(/);
    expect(src).toMatch(/\.catch\(function \(error\) \{[^}]*Notify\.danger/);
    // Non-vacuity: the unconditional toast that fired beside the copy is gone.
    expect(src).not.toMatch(/Clipboard\.copy\(text\);\s*Notify\.success/);
  });

  it('says what failed, in the active voice the rest of the product uses', () => {
    const src = code(COPY_JS);
    expect(src).toMatch(/const NOT_COPIED = 'Could not copy the issue details to the clipboard';/);
    // Non-vacuity: the passive form, which is the one convention this file broke.
    expect(src).not.toMatch(/could not be copied/);
  });

  it('that convention is the one its siblings follow', () => {
    // Cross-file anchor: the clipboard failure this file was modelled on, and the
    // wider "Could not <verb>" house style - including the one in jira.js, which
    // sits in the very same Tasks panel. A rewrite of those would be the only
    // honest reason to rewrite this one.
    expect(code('imports/client/ui/settings/profile.js')).toMatch(/'Could not copy to clipboard'/);
    expect(code('imports/client/ui/common/jira.js')).toMatch(/'Could not remove Jira issue'/);
    expect(code('imports/client/ui/vulnerability-lake/vulnerability-lake-cwe.js'))
      .toMatch(/'Could not load CWE details\.'/);
  });

  it('never shows a bare DOMException as the whole message', () => {
    // navigator.clipboard rejects with "Document is not focused." or "Write
    // permission denied." - true, but they name no subject, so the toast never
    // said what had failed. The reason belongs in the console.
    const src = code(COPY_JS);
    expect(src).toMatch(/\.catch\(function \(error\) \{\s*console\.error\(error\);\s*Notify\.danger\(NOT_COPIED\);/);
    expect(src).not.toMatch(/Notify\.danger\(\(error/);
  });

  it('the non-secure-context fallback takes its outcome from the copy event', () => {
    // document.execCommand('copy') fires a `copy` event only when it is allowed
    // to run, so that event is the signal clipboard.js throws away.
    const src = code(COPY_JS);
    expect(src).toMatch(/document\.addEventListener\('copy'/);
    expect(src).toMatch(/document\.removeEventListener\('copy'/);
    expect(src).toMatch(/if \(copied\) \{\s*Notify\.success\(COPIED\);\s*\} else \{\s*Notify\.danger\(NOT_COPIED\);/);
  });
});

describe('the issue text a ticket gets pasted from', () => {
  it('status is only ever warnings or violations by the time it reaches that text', () => {
    // The whole grammar fix rests on this domain: the notOk gate excludes 'ok',
    // so a sentence built around the value has to read for the other two.
    expect(code(COMPONENT_JS)).toMatch(/const status = \['ok', 'warnings', 'violations'\];/);
  });

  it.each(TEXT_BUILDERS)('%s never says "resolve this <status>"', (file) => {
    const src = code(file);
    expect(src).toMatch(/resolve the reported '/);
    // Non-vacuity: "resolve this violations" / "resolve this warnings" - never
    // grammatical, in either branch.
    expect(src).not.toMatch(/resolve this ' \+/);
  });

  it.each(PROBLEM_DESCRIPTION_HELPERS)('%s lists one path per entry, not one array per version', (file) => {
    const src = code(file);
    expect(src).toMatch(/const paths = _\.flatten\(_\.map\(item\.versions/);
    // Non-vacuity: the un-flattened map rendered "/a/b,/a/c; /d".
    expect(src).not.toMatch(/const paths = _\.map\(item\.versions/);
  });

  it.each(PROBLEM_DESCRIPTION_HELPERS)('%s drops a sentence it has nothing to fill', (file) => {
    const src = code(file);
    expect(src).toMatch(/\(reasons\.length \? 'This is due to '/);
    expect(src).toMatch(/\(paths\.length \? 'The component is found at: '/);
    // Non-vacuity: the unguarded forms rendered "This is due to ." on their own.
    expect(src).not.toMatch(/\n\s*'This is due to '\+ reasons\.join/);
    expect(src).not.toMatch(/\n\s*'The component is found at: '\+ paths\.join/);
  });

  it('the license variant addresses the reader the same way in both branches', () => {
    const src = code(LICENSE_JS);
    // The two branches used to ask for different things - "Please check the need
    // for it in 3 components" against "Please check whether this license is still
    // needed" - and neither matched the component twins, which both use the
    // "check whether ... is still needed" form.
    expect(src).toMatch(/\? 'Please check whether this license is still needed in '\+ Pluralize/);
    // ...and it still says something sensible when the license has no component
    // recorded, rather than "in 0 components" followed by an empty "Components are:".
    expect(src).toMatch(/: 'Please check whether this license is still needed and resolve/);
    // Non-vacuity: neither the divergent phrasing nor the ungrammatical original.
    expect(src).not.toMatch(/Please check the need for it/);
  });

  it('the license variant asks the same question its component twins ask', () => {
    // Cross-file invariant: one wording for the three panels, so a reader moving
    // between them is not addressed differently for no reason.
    const ask = /Please check whether this \w+ is still needed/;
    for (const file of TEXT_BUILDERS) {
      expect(code(file)).toMatch(ask);
    }
  });

  it('the component list it appends ends in a full stop like its neighbours', () => {
    const src = code(LICENSE_JS);
    expect(src).toMatch(/'Components are: '\+ components\.join\(', '\) \+'\. \\n'/);
    // Non-vacuity: the sentence that trailed off without one.
    expect(src).not.toMatch(/'Components are: '\+ components\.join\(', '\) \+' \\n'/);
  });

  it.each(TEXT_BUILDERS)('%s writes that text with plain hyphens', (file) => {
    // raw(), not code(): the em-dash this guards against shipped into the client
    // bundle from a COMMENT inside this very helper.
    const body = raw(file).match(/getProblemDescription: function[\s\S]*?\n {2}\},\n/);
    expect(body).not.toBeNull();
    expect(body[0]).not.toMatch(/[\u2013\u2014]/);
  });

  it.each([COPY_JS, COPY_HTML, ACTIVATE_JS])('%s uses plain hyphens throughout', (file) => {
    expect(raw(file)).not.toMatch(/[\u2013\u2014]/);
  });
});

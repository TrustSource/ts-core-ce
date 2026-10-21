/* eslint-disable no-undef */
// Static-source regression for API key reveal (FRONTEND half, PERSONAL API keys page):
// imports/client/ui/settings/profile.js / profile.html is a separate page from
// the company-wide settings/api/company-api-keys.js (covered by
// company-api-keys-reveal.frontend.unit.spec.js) but is driven by the same
// createApiKeyByUser/updateApiKeyByUser methods that changed for key reveal, and got
// the same reveal-on-copy treatment: no more embedding the plaintext key in
// the DOM (`data-clipboard-text="{{this.key}}"` + clipboard.js), reveal only
// on-demand via `Meteor.callAsync('apiKey.reveal', id)`, written to the
// clipboard with the native `navigator.clipboard` API.
//
// One deliberate difference from the company-wide page worth locking down:
// profile.js keeps a client-side getVisibleKey(value) fallback for the masked
// "partial view" column (`object.maskedKey || getVisibleKey(value)`) instead
// of dropping the client-side mask helper entirely - because a personal key
// created before the key-hashing migration ran may still be missing maskedKey. This
// spec asserts that fallback stays in place, not removed as it was on the
// company-wide page.
//
// WHY source-text pattern matching, not a rendered-Blaze/jsdom test: see
// company-api-keys-reveal.frontend.unit.spec.js for the full rationale (no
// jsdom/Blaze unit-test harness in this repo; profile.js imports
// 'meteor/meteor'/'meteor/templating'/jQuery/etc that jest cannot resolve).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../imports/client/ui/settings');
const jsRaw = fs.readFileSync(path.join(root, 'profile.js'), 'utf8');
const htmlRaw = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');

// Strip JS comments so a stale pattern can't hide in a comment and falsely pass.
const jsCode = jsRaw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function must(match, label) {
  if (!match) {
    throw new Error(`profile-api-keys-reveal.frontend.unit.spec.js: could not locate ${label} - ` +
      'has profile.js/.html been renamed or restructured?');
  }
  return match;
}

describe('#72 profile.html no longer embeds the plaintext key in the DOM (personal API keys)', () => {
  it('the copy button has no data-clipboard-text attribute', () => {
    expect(htmlRaw).not.toMatch(/data-clipboard-text/);
  });

  it('no raw {{this.key}} interpolation survives anywhere on the page', () => {
    expect(htmlRaw).not.toMatch(/\{\{\s*this\.key\s*\}\}/);
  });

  it('the reactiveTablePersonalApiKeyActions copy button still exists with the copy-api-key class', () => {
    expect(htmlRaw).toMatch(/<template name="reactiveTablePersonalApiKeyActions">/);
    expect(htmlRaw).toMatch(/class="btn btn-info btn-sm copy-api-key inner-r-10"/);
  });
});

describe('#72 profile.js no longer uses clipboard.js for the personal API keys page', () => {
  it('does not import the clipboard package', () => {
    expect(jsCode).not.toMatch(/from\s+'clipboard'/);
  });

  it('does not construct a Clipboard instance', () => {
    expect(jsCode).not.toMatch(/new Clipboard\(/);
  });

  it('removed the onCreated hook that used to wire up clipboard.js on this template', () => {
    expect(jsCode).not.toMatch(/Template\.reactiveTablePersonalApiKeyActions\.onCreated/);
  });
});

describe('#72 profile.js copy-api-key click handler calls apiKey.reveal then clipboard.writeText', () => {
  const handlerSrc = must(
    jsCode.match(/'click \.copy-api-key':\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n  \},/),
    "'click .copy-api-key' event handler"
  )[0];

  it('reads the row id from the template data context (this.id) - this page has no data-id DOM attribute', () => {
    expect(handlerSrc).toMatch(/const id = this\.id/);
  });

  it('calls Meteor.callAsync(\'apiKey.reveal\', id) - exact method name and single id argument', () => {
    expect(handlerSrc).toMatch(/Meteor\.callAsync\('apiKey\.reveal',\s*id\)/);
  });

  it('writes the resolved plaintext key to the clipboard via navigator.clipboard.writeText', () => {
    expect(handlerSrc).toMatch(/navigator\.clipboard\.writeText\(/);
  });

  it('shows the existing success toast copy on success', () => {
    expect(handlerSrc).toMatch(/Notify\.success\('Information was successfully copied'\)/);
  });

  // Asserted as an invariant rather than a code shape. This pinned the literal
  // `.catch(function (error) { ... Notify.danger(` and went red in 3.3.22, when
  // the body was legitimately hoisted into a shared notifyFailure() so the
  // reveal and the clipboard write could report through one path. The behaviour
  // it guards - a rejection surfaces as a danger toast - was never broken.
  it('shows a Notify.danger error (not a silent failure) on rejection', () => {
    expect(handlerSrc).toMatch(/\.catch\(/);
    // nothing is swallowed by an empty catch
    expect(handlerSrc).not.toMatch(/\.catch\(\s*function\s*\([^)]*\)\s*\{\s*\}\s*\)/);
    // and the failure reaches Notify.danger, whether reported inline in the
    // catch or through a named handler the catch is handed
    const reportsInline = /\.catch\(function[\s\S]*?Notify\.danger\(/.test(handlerSrc);
    const reportsViaNamedHandler = (handlerSrc.match(/\.catch\(([A-Za-z_$][\w$]*)\)/g) || [])
      .map(function (c) { return c.slice('.catch('.length, -1); })
      .some(function (name) {
        return new RegExp(name + '\\s*=\\s*function[\\s\\S]*?Notify\\.danger\\(').test(handlerSrc);
      });
    expect(reportsInline || reportsViaNamedHandler).toBe(true);
  });
});

// Regression for the clipboard "Could not copy to clipboard" bug: the reveal is
// a server round-trip, so awaiting it and THEN calling writeText loses the
// click's transient user activation and browsers (Safari especially) reject the
// write. The fix hands the clipboard a PROMISE for the key so the write stays
// authorized by the original click, with a writeText fallback for browsers
// without async ClipboardItem support.
describe('clipboard write stays tied to the click via a promise (transient-activation fix)', () => {
  const handlerSrc = must(
    jsCode.match(/'click \.copy-api-key':\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n  \},/),
    "'click .copy-api-key' event handler"
  )[0];

  it('captures the reveal promise once instead of writing inside its .then', () => {
    expect(handlerSrc).toMatch(/const reveal = Meteor\.callAsync\('apiKey\.reveal',\s*id\)/);
  });

  it('feature-detects ClipboardItem before using the promise-based clipboard write', () => {
    expect(handlerSrc).toMatch(/typeof ClipboardItem !== 'undefined'/);
  });

  it('hands the clipboard a promise for the key so the write is authorized by the click', () => {
    expect(handlerSrc).toMatch(/navigator\.clipboard\.write\(\[new ClipboardItem\(/);
    expect(handlerSrc).toMatch(/reveal\.then\(function \(plainKey\)[\s\S]*?new Blob\(\[plainKey\]/);
  });

  it('keeps a writeText fallback for browsers without async ClipboardItem support', () => {
    expect(handlerSrc).toMatch(/else \{[\s\S]*navigator\.clipboard\.writeText\(plainKey\)/);
  });
});

describe('#72 masked "partial view" column prefers server-provided maskedKey, ' +
  'with a legacy client-side fallback for pre-migration personal keys', () => {
  const keyFieldSrc = must(
    jsCode.match(/fieldId:\s*'key',[\s\S]*?fn:\s*function\s*\(value,\s*object\)\s*\{[\s\S]*?\n\s*\}\s*\},/),
    "reactive-table 'key' field definition"
  )[0];

  it('still shows "Key available after publish" for unpublished rows (unchanged UX)', () => {
    expect(keyFieldSrc).toMatch(/Key available after publish/);
  });

  it('returns object.maskedKey with a getVisibleKey(value) fallback (deliberately kept, unlike the company-wide page)', () => {
    expect(keyFieldSrc).toMatch(/return object\.maskedKey \|\| getVisibleKey\(value\)/);
  });

  it('the getVisibleKey mask helper itself is still defined (not removed, since the fallback above calls it)', () => {
    expect(jsCode).toMatch(/function getVisibleKey\(apiKey\)/);
  });
});

describe('#72 publish/unpublish flows use maskedKey for audit-log messages and id for session-cache matching', () => {
  it('"published" log message uses self.maskedKey', () => {
    expect(jsCode).toMatch(/'Api key '\+self\.maskedKey\+' published'/);
  });

  it('"unpublished" log message uses self.maskedKey', () => {
    expect(jsCode).toMatch(/'Api key '\+self\.maskedKey\+' unpublished'/);
  });

  it('publish/unpublish session-cache reconciliation matches by id (exactly twice: publish + unpublish)', () => {
    const matches = jsCode.match(/item\.id === apiKey\.id/g) || [];
    expect(matches.length).toBe(2);
  });

  it('no stale item.key === apiKey.key matching survives (key is no longer client-visible post-creation)', () => {
    expect(jsCode).not.toMatch(/item\.key === apiKey\.key/);
  });
});

describe('#72 create-success log message uses the server-returned maskedKey', () => {
  it('"created"/create-flow log message uses apiKey.maskedKey, not a client-side mask of the plaintext key', () => {
    expect(jsCode).toMatch(/'Api key '\+apiKey\.maskedKey\+/);
    expect(jsCode).not.toMatch(/getVisibleKey\(apiKey\.key\)/);
  });
});

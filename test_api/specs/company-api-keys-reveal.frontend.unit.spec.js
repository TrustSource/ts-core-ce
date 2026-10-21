/* eslint-disable no-undef */
// Static-source regression for API key reveal (FRONTEND half): the company API keys
// settings page must stop embedding the full plaintext key in the DOM at all
// times (`data-clipboard-text="{{this.key}}"` + clipboard.js) and instead
// reveal the plaintext only on-demand via `Meteor.callAsync('apiKey.reveal',
// id)`, writing it to the clipboard with the native `navigator.clipboard`
// API. The masked "partial view" column must read the server-computed
// `maskedKey` field instead of computing it client-side from a now-absent
// plaintext `key`.
//
// WHY source-text pattern matching, not a rendered-Blaze/jsdom test: this
// repo has no jsdom/Blaze unit-test harness (confirmed by existing precedents
// - see approve-generation-progress.frontend.unit.spec.js,
// component-details-license-init.frontend.unit.spec.js,
// project-settings-architecture-upload.frontend.unit.spec.js), and
// company-api-keys.js imports 'meteor/meteor', 'meteor/templating', jQuery,
// etc which jest (no babel transform registered in jest.config.js) cannot
// resolve. This follows the same established pattern: assert on the real,
// shipped source text (with comments stripped so a match can't hide in a
// comment) so a regression is caught even without executing the Blaze
// template pipeline. QA/qa-automation cover the actual click-through/
// clipboard/audit-log behavior in the browser.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../imports/client/ui/settings/api');
const jsRaw = fs.readFileSync(path.join(root, 'company-api-keys.js'), 'utf8');
const htmlRaw = fs.readFileSync(path.join(root, 'company-api-keys.html'), 'utf8');
const createJsRaw = fs.readFileSync(path.join(root, 'company-api-keys-create.js'), 'utf8');

// Strip JS comments so a stale pattern can't hide in a comment and falsely pass.
const jsCode = jsRaw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const createJsCode = createJsRaw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function must(match, label) {
  if (!match) {
    throw new Error(`company-api-keys-reveal.frontend.unit.spec.js: could not locate ${label} - ` +
      'has company-api-keys.js/.html been renamed or restructured?');
  }
  return match;
}

describe('#72 company-api-keys.html no longer embeds the plaintext key in the DOM', () => {
  it('the copy button uses data-id (not data-clipboard-text) bound to the row id', () => {
    expect(htmlRaw).toMatch(/class="btn btn-info btn-sm copy-api-key inner-r-10"[^>]*data-id="\{\{this\.id\}\}"/);
  });

  it('no data-clipboard-text attribute survives anywhere on the page', () => {
    expect(htmlRaw).not.toMatch(/data-clipboard-text/);
  });

  it('no raw {{this.key}} interpolation survives anywhere on the page', () => {
    expect(htmlRaw).not.toMatch(/\{\{\s*this\.key\s*\}\}/);
  });
});

describe('#72 company-api-keys.js no longer uses clipboard.js', () => {
  it('does not import the clipboard package', () => {
    expect(jsCode).not.toMatch(/from\s+'clipboard'/);
  });

  it('does not construct a Clipboard instance', () => {
    expect(jsCode).not.toMatch(/new Clipboard\(/);
  });

  it('removed the client-side getVisibleKey mask helper (relocated server-side as maskKey)', () => {
    expect(jsCode).not.toMatch(/function getVisibleKey/);
  });
});

describe('#72 company-api-keys.js copy-api-key click handler calls apiKey.reveal then clipboard.writeText', () => {
  const handlerSrc = must(
    jsCode.match(/'click \.copy-api-key':\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n  \}(?:,|\n\}\);)/),
    "'click .copy-api-key' event handler"
  )[0];

  it('reads the row id from the data-id attribute of the clicked element', () => {
    expect(handlerSrc).toMatch(/\$\(event\.currentTarget\)\.data\('id'\)/);
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

  it('does NOT call logEvent from the client for this action (server logs the reveal itself)', () => {
    expect(handlerSrc).not.toMatch(/logEvent/);
  });
});

// Regression for the clipboard "NotAllowedError"/"Access Denied"-page bug: the
// reveal is a server round-trip, so awaiting it and THEN calling writeText loses
// the click's transient user activation and browsers (Safari especially) reject
// the write. The fix hands the clipboard a PROMISE for the key so the write
// stays authorized by the original click, with a writeText fallback for
// browsers without async ClipboardItem support.
describe('clipboard write stays tied to the click via a promise (transient-activation fix)', () => {
  const handlerSrc = must(
    jsCode.match(/'click \.copy-api-key':\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n  \}(?:,|\n\}\);)/),
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

describe('#72 masked "partial view" column reads server-provided maskedKey', () => {
  const keyFieldSrc = must(
    jsCode.match(/fieldId:\s*'key',[\s\S]*?fn:\s*function\s*\(value,\s*object\)\s*\{[\s\S]*?\n\s*\}\s*\},/),
    "reactive-table 'key' field definition"
  )[0];

  it('still shows "Key available after publish" for unpublished rows (unchanged UX)', () => {
    expect(keyFieldSrc).toMatch(/Key available after publish/);
  });

  it('returns object.maskedKey for published rows instead of computing it from a plaintext value', () => {
    expect(keyFieldSrc).toMatch(/return object\.maskedKey/);
    expect(keyFieldSrc).not.toMatch(/getVisibleKey\(value\)/);
  });
});

describe('#72 update/publish/unpublish/delete audit-log messages use self.maskedKey (self.key no longer exists client-side)', () => {
  it('no getVisibleKey(self.key) usage survives (would log "Api key undefined ...")', () => {
    expect(jsCode).not.toMatch(/getVisibleKey\(self\.key\)/);
  });

  it('"updated" log messages (name change + scope change) use self.maskedKey', () => {
    const matches = jsCode.match(/'Api key '\+self\.maskedKey\+' updated'/g) || [];
    expect(matches.length).toBe(2);
  });

  it('"published" log message uses self.maskedKey', () => {
    expect(jsCode).toMatch(/'Api key '\+self\.maskedKey\+' published'/);
  });

  it('"unpublished" log message uses self.maskedKey', () => {
    expect(jsCode).toMatch(/'Api key '\+self\.maskedKey\+' unpublished'/);
  });

  it('"deleted" log message uses self.maskedKey', () => {
    expect(jsCode).toMatch(/'Api key '\+self\.maskedKey\+' deleted'/);
  });
});

describe('#72 company-api-keys-create.js create-success log message uses the server-returned maskedKey', () => {
  it('removed its own copy of the getVisibleKey mask helper', () => {
    expect(createJsCode).not.toMatch(/function getVisibleKey/);
  });

  it('no getVisibleKey(data.key) usage survives (data.key is no longer returned by apiKey.create)', () => {
    expect(createJsCode).not.toMatch(/getVisibleKey\(data\.key\)/);
  });

  it('"created" log message uses data.maskedKey', () => {
    expect(createJsCode).toMatch(/'New Api key '\+data\.maskedKey\+' created'/);
  });

  it('does not render the raw new key anywhere post-creation (only a success toast + modal close)', () => {
    // createModalMsg is only ever cleared (Session.set('createModalMsg') with
    // no second arg), never set to an actual value - confirming this page has
    // no "here's your new key, copy it now" display to preserve/break.
    expect(createJsCode).not.toMatch(/Session\.set\('createModalMsg',\s*[^)]+\)/);
  });
});

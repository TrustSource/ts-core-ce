/* eslint-disable no-undef */
// SweetAlert confirmations rendered with `html: true`.
//
// sweetalert 1.1.3 writes `title` and `text` into the page as HTML when html:true
// is set (every "please give a reason" dialog needs it for its <textarea>). Many
// of those dialogs spliced stored text into that HTML - a CVE id, an obligation
// name, a legal-rule message, a product, CSAF document or API-key name - so
// markup in the value ran for whoever opened the dialog.
//
// This scans every swal({...}) options object in the client that sets html:true
// and fails on any value concatenated or interpolated into it without
// escapeHtml(...). Variables named safe* hold text a dialog escaped up front
// (component-license-resolve.js); the allowlist below is for values that are not
// text at all.
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const REPO = path.join(__dirname, '../..');

// Values that are numbers, not text.
const NOT_TEXT = new Set(['isFiltered']);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

// The first argument of each swal( call, when it is an object literal.
function swalOptionObjects(source) {
  const found = [];
  const re = /\bswal\(\s*\{/g;
  let match;
  while ((match = re.exec(source))) {
    const start = source.indexOf('{', match.index);
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          found.push({text: source.slice(start, i + 1), line: source.slice(0, start).split('\n').length});
          break;
        }
      }
    }
  }
  return found;
}

function isSafe(expression) {
  const expr = expression.trim();
  return /^escapeHtml\(/.test(expr) || /^safe[A-Z]/.test(expr) || NOT_TEXT.has(expr);
}

function unescapedInsertions(options) {
  const hits = [];
  // `'...' + value` and `value + '...'`
  for (const m of options.matchAll(/\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+|\([^()]*\))*)/g)) {
    if (!isSafe(m[1])) hits.push(m[1]);
  }
  for (const m of options.matchAll(/([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\+\s*['"`]/g)) {
    if (!isSafe(m[1])) hits.push(m[1]);
  }
  // `${value}` inside template literals
  for (const m of options.matchAll(/\$\{([^}]*)\}/g)) {
    if (!isSafe(m[1])) hits.push(m[1].trim());
  }
  return hits;
}

const clientFiles = execSync('git ls-files "imports/client/*.js" "client/*.js"', {cwd: REPO})
  .toString().trim().split('\n')
  .filter((rel) => rel && !rel.endsWith('.spec.js'));

const htmlDialogs = [];
clientFiles.forEach((rel) => {
  const source = stripComments(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  swalOptionObjects(source)
    .filter((options) => /\bhtml\s*:\s*true\b/.test(options.text))
    .forEach((options) => htmlDialogs.push({rel, line: options.line, text: options.text}));
});

describe('SweetAlert html:true dialogs escape inserted values', () => {
  it('finds the dialogs it is meant to guard (non-vacuous)', () => {
    expect(htmlDialogs.length).toBeGreaterThanOrEqual(15);
  });

  it.each(htmlDialogs.map((d) => [`${d.rel}:${d.line}`, d]))('%s', (label, dialog) => {
    expect(unescapedInsertions(dialog.text)).toEqual([]);
  });
});

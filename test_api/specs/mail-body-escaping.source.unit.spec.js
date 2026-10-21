/* eslint-disable no-undef */
// Every value put into the HTML of an outgoing mail is escaped: user, inviter, company,
// project, module, release and component names, comments and URLs can all carry markup
// (several come straight from scan uploads). A mail body is a `+` chain; each operand
// must be a string literal, an escapeHtml(...) call, a footer helper, or one of the
// reviewed markup pieces below whose own values are escaped.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const FILES = ['imports/server/collections/users.js', 'imports/server/collections/modules.js',
  'imports/startup/server/accounts.js'];

// Markup operands, reviewed: each escapes the values it contains.
const REVIEWED_MARKUP = [
  "(approve.rejected ? '<p>' + escapeHtml(releaseComment) + '</p>' : '')",
  '` contains ${escapeHtml(item.key)} ${escapeHtml(item.versions)}`',
  "(componentText ? '<p>' + escapeHtml(componentText) + '</p>' : '')",
  "(warningsText ? '<p>' + escapeHtml(warningsText) + '</p>' : '')",
  "(violationsText ? '<p>' + escapeHtml(violationsText) + '</p>' : '')",
  "(vulnerabilitiesText ? '<p>' + escapeHtml(vulnerabilitiesText) + '</p>' : '')",
  "comps.join('')",
  'CLICK_TRACKING',
  'description'
];
const SAFE_CALLS = ['mailFooter()', 'supportContact()'];

function statementEnd(src, from) {
  let quote = null; let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; } else if (c === quote) { quote = null; }
    } else if ('\'"`'.includes(c)) { quote = c; } else if ('([{'.includes(c)) { depth += 1; } else if (')]}'.includes(c)) {
      depth -= 1;
    } else if (c === ';' && depth === 0) { return i; }
  }
  throw new Error('unterminated mail body');
}

function operands(src, from, to) {
  const out = []; let quote = null; let depth = 0; let start = from;
  for (let i = from; i < to; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; } else if (c === quote) { quote = null; }
    } else if ('\'"`'.includes(c)) { quote = c; } else if ('([{'.includes(c)) { depth += 1; } else if (')]}'.includes(c)) {
      depth -= 1;
    } else if (c === '+' && depth === 0) { out.push(src.slice(start, i).trim()); start = i + 1; }
  }
  out.push(src.slice(start, to).trim());
  return out.filter(Boolean);
}

const isLiteral = (t) => /^'(?:[^'\\]|\\.)*'$|^"(?:[^"\\]|\\.)*"$/.test(t);

describe('outgoing mail bodies escape every value', () => {
  it.each(FILES)('%s', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const starts = [...src.matchAll(/(?:const|let)\s+userMailBody\s*=|return\s+(?='<p>)/g)].map((m) => m.index + m[0].length);
    expect(starts.length).toBeGreaterThan(0);
    const unescaped = [];
    starts.forEach((start) => {
      operands(src, start, statementEnd(src, start)).forEach((op) => {
        if (!isLiteral(op) && !op.startsWith('escapeHtml(') && !SAFE_CALLS.includes(op) && !REVIEWED_MARKUP.includes(op)) {
          unescaped.push(op);
        }
      });
    });
    expect(unescaped).toEqual([]);
  });

  it('escapes the inviter and company in the invitation', () => {
    const src = fs.readFileSync(path.join(ROOT, 'imports/startup/server/accounts.js'), 'utf8');
    expect(src).toMatch(/escapeHtml\(inviter\.profile\.name\) \+ ' \(' \+ escapeHtml\(company\.name\) \+ '\) '/);
  });

  it('escapes the version-jump list entries', () => {
    const src = fs.readFileSync(path.join(ROOT, 'imports/server/collections/modules.js'), 'utf8');
    expect(src).toMatch(/<p>\$\{escapeHtml\(comp\.key\)\} \(\$\{escapeHtml\(versionings\[0\]\.extra\.past\)\}/);
  });
});

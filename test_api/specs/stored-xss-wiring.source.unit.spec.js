/* eslint-disable no-undef */
// Stored XSS: every list cell and confirmation dialog that put stored text into
// markup now escapes it. The builders are covered by table-cells-html.unit.spec.js;
// this locks each page onto them, because a Blaze page cannot be rendered under
// Jest. A live browser check confirmed the scan list rendered branch, tag and
// binary-link markup as real elements before the fix.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const UI = 'imports/client/ui/';

// Comment-blind assertions would happily pass on commented-out code.
function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const importsFrom = (source, name, from) =>
  new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'${from.replace(/\//g, '\\/')}'`).test(source);

describe('scan and analysis metadata', () => {
  it.each([
    `${UI}scan/scan-list.js`,
    `${UI}approves/approves-details-overview.js`,
    `${UI}module/module-approve/module-approve.js`
  ])('%s builds the chips with metaChip and concatenates no raw field', (rel) => {
    const source = read(rel);
    expect(importsFrom(source, 'metaChip', '/imports/lib/html/tableCells')).toBe(true);
    expect(source).not.toMatch(/<span>'\s*\+\s*(object|module)\.(branch|tag|version|release)\b/);
    expect(source).not.toMatch(/<span>'\s*\+\s*link\.name\b/);
    expect(source).toMatch(/metaChip\([^)]*\.branch\)/);
    expect(source).toMatch(/metaChip\([^)]*\.tag\)/);
  });
});

describe('other cells built from stored text', () => {
  it('the CSAF list escapes the document name and the failure reason', () => {
    const source = read(`${UI}csaf/csaf-list.js`);
    expect(importsFrom(source, 'escapeHtml', '/imports/client/ui/helpers/template-helpers')).toBe(true);
    expect(source).not.toMatch(/let reason = object\.publishedFileName \|\|\s*object\.name \|\| ''\s*\n/);
    expect(source).toMatch(/escapeHtml\(object\.publishedFileName \|\|\s*object\.name \|\| ''\)/);
    expect(source).toMatch(/escapeHtml\(object\.removedReason \|\|\s*object\.failedReason \|\| ''\)/);
  });

  it('the vulnerability lake component search escapes vulnerability ids', () => {
    const source = read(`${UI}vulnerability-lake/vulnerability-lake-search-vulns.js`);
    expect(source).toMatch(/escapeHtml\(vuln\.id\)/);
    expect(source).toMatch(/escapeHtml\(href\)/);
    expect(source).not.toMatch(/\$\{vuln\.id\}/);
  });
});

describe('confirmation dialogs rendered as HTML', () => {
  it.each([
    [`${UI}approves/approves-details.js`, /reject approval ' \+ escapeHtml\(self\.name\)/],
    [`${UI}releases/releases-details.js`, /reject approval ' \+ escapeHtml\(self\.name\)/],
    [`${UI}csaf/csaf-list.js`, /publish ' \+ escapeHtml\(name\)/]
  ])('%s escapes the name in its html:true title', (rel, pattern) => {
    const source = read(rel);
    expect(importsFrom(source, 'escapeHtml', '/imports/client/ui/helpers/template-helpers')).toBe(true);
    expect(source).toMatch(pattern);
  });
});

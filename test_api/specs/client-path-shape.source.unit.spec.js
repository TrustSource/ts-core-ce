/* eslint-disable no-undef */
// A version's `paths` entries are plain strings on every analysis the current worker
// writes; only much older records carry {path, licenses}. A client that reads `.path`
// off a string silently renders nothing (the dependency aside showed an empty path and
// copied an empty clipboard value) and sends `paths: [undefined]` into the component
// modification it creates. Every reader goes through pathLocation/pathLicenses.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const HELPER = '/imports/lib/analysis/pathLocation';
const UI = 'imports/client/ui/';

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// source with comment lines stripped, so a comment quoting the old shape is not a hit
function live(rel) {
  return read(rel)
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

const READERS = [
  `${UI}module/module-details/module-detail-component.js`,
  `${UI}module/module-details/module-dependencies/module-dependencies-aside.js`,
  `${UI}module/common/component-multy-license.js`,
  `${UI}helpers/template-helpers.js`
];

describe('the client reads a path through the shared helper', () => {
  it.each(READERS)('%s imports it', (rel) => {
    expect(live(rel)).toMatch(new RegExp("import \\{[^}]*pathLocation[^}]*\\} from '" + HELPER + "'"));
  });

  it.each(READERS)('%s never reads .path off a path entry', (rel) => {
    // `pathLicenses(path.path)` and `pathLocation(this.path)` are the allowed forms:
    // there the OUTER object is the Blaze wrapper, and the entry goes to the helper.
    const source = live(rel).replace(/path(?:Location|Licenses)\([^)]*\)/g, 'HELPER');
    expect(source).not.toMatch(/\.path\.path\b/);
    expect(source).not.toMatch(/\bpath\s*&&\s*path\.path\b/);
    expect(source).not.toMatch(/\bpaths:\s*\[\s*this\.path\.path\s*\]/);
  });
});

describe('formatPath', () => {
  const source = live(`${UI}helpers/template-helpers.js`);

  it('resolves the location before escaping it', () => {
    expect(source).toMatch(/const location = pathLocation\(path\)/);
    expect(source).toMatch(/escapeHtml\(location\)/);
    expect(source).not.toMatch(/escapeHtml\(path\.path\)/);
  });

  it('still escapes the scan-supplied path', () => {
    expect(source).toMatch(/escapeHtml\(/);
  });

  it('is the only implementation left', () => {
    const copies = [
      `${UI}module/module-details/module-detail-component.js`,
      `${UI}module/module-details/module-detail-vulnerability-item.js`,
      `${UI}module/module-details/module-dependencies/module-dependencies-aside.js`
    ].filter((rel) => /formatPath:\s*function/.test(live(rel)));
    expect(copies).toEqual([]);
  });

  it('exposes the bare location to templates for attribute values', () => {
    expect(source).toMatch(/Template\.registerHelper\('pathLocation', pathLocation\)/);
  });
});

describe('the dependency aside template', () => {
  const html = read(`${UI}module/module-details/module-dependencies/module-dependencies-aside.html`);

  it('fills title and clipboard from the location helper, not {{path.path}}', () => {
    expect(html).not.toContain('{{path.path}}');
    expect(html).toContain('title="{{pathLocation path}}"');
    expect(html).toContain('data-clipboard-text="{{pathLocation path}}"');
  });
});

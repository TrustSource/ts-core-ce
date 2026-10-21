/* eslint-disable no-undef */
// The app ships Bootstrap 3 from packages/bootstrap-noglyph. 3.4.1 is the last 3.x
// release; its two open XSS advisories are closed by patching the vendored copy.
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const JS = read('packages/bootstrap-noglyph/upstream/dist/js/bootstrap.js');

describe('vendored Bootstrap', () => {
  it('ships 3.4.1 JavaScript and CSS', () => {
    expect(JS).toMatch(/Bootstrap v3\.4\.1/);
    expect(read('packages/bootstrap-noglyph/upstream/dist/css/bootstrap.css')).toMatch(/Bootstrap v3\.4\.1/);
  });

  it('has no carousel plugin (CVE-2024-6484)', () => {
    expect(JS).not.toMatch(/Carousel\.prototype/);
    expect(JS).not.toMatch(/data-ride="carousel"/);
  });

  it('sets button state text as text, not HTML (CVE-2024-6485)', () => {
    expect(JS).toMatch(/var val {2}= \$el\.is\('input'\) \? 'val' : 'text'/);
  });

  it('is the only Bootstrap: no npm copy that audits would flag', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies.bootstrap).toBeUndefined();
    expect((pkg.devDependencies || {}).bootstrap).toBeUndefined();
  });
});

describe('meteor-node-stubs bundled dependencies', () => {
  it('replaces the bundled pbkdf2 with the patched hoisted copy', () => {
    expect(JSON.parse(read('package.json')).resolutions.pbkdf2).toBe('3.1.7');
    expect(read('tools/patch-node-stubs.js')).toMatch(/const bundledOverrides = \[[^\]]*'pbkdf2'[^\]]*\];/);
  });
});

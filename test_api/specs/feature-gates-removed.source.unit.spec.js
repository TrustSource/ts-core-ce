/* eslint-disable no-undef */
// The Community Edition has one tier: every company has every feature. No code may
// check the company feature list (allowedLicenses) or gate a method on it.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '');
}

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.(js|html)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

const FILES = walk('imports', []);

describe('no feature-list gate remains', () => {
  it.each([
    ['requireFeature(', /\brequireFeature\(/],
    ['gatedByFeature(', /\bgatedByFeature\(/],
    ['allowedLicenses read', /allowedLicenses/],
    ['isSARIFEnabled', /\bisSARIFEnabled\b/],
    ['risksFeatureEnabled', /\brisksFeatureEnabled\b/],
    ['LICENSED_COLUMNS', /\bLICENSED_COLUMNS\b/],
    ['feature not enabled message', /feature is not enabled/i]
  ])('%s', (label, pattern) => {
    const allowed = ['imports/lib/interactors/companies/protectedFields.js'];
    const offenders = FILES.filter((rel) => allowed.indexOf(rel) === -1 && pattern.test(live(rel)));
    expect(offenders).toEqual([]);
  });
});

describe('the gated method groups are registered plainly', () => {
  it.each([
    'imports/startup/server/products.js',
    'imports/startup/server/csaf.js',
    'imports/startup/server/riskProperties.js'
  ])('%s registers methods', (rel) => {
    expect(live(rel)).toMatch(/Meteor\.methods\(/);
  });
});

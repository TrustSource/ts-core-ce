/* eslint-disable no-undef */
// Every interactor that acts on behalf of a user resolves that user through
// resolveActingUser, and no longer trusts a `X || Meteor.userAsync()` argument.
// The helper itself is covered by acting-user.unit.spec.js; these guards keep a
// client-supplied user from re-entering a write path (the code runs only inside
// a Meteor method, so it cannot be exercised under Jest).
//
// It also locks the two scan reads that scope by company: they refuse a caller
// with no company instead of running an unscoped query, and strip Mongo
// operators from the client selector.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const ACTING_USER_SITES = [
  ['imports/lib/interactors/products/exportList.js', /resolveActingUser\(\s*this\s*,\s*apiUser\s*\)/],
  ['imports/lib/interactors/products/create.js', /resolveActingUser\(\s*this\s*,\s*apiUser\s*\)/],
  ['imports/lib/interactors/products/importFile.js', /resolveActingUser\(\s*this\s*,\s*apiUser\s*\)/],
  ['imports/lib/interactors/approves/markDocumentsAsReleased.js', /resolveActingUser\(\s*this\s*,\s*user\s*\|\|\s*apiUser\s*\)/],
  ['imports/lib/interactors/approves/approve.js', /resolveActingUser\(\s*this\s*,\s*apiUser\s*\)/],
  ['imports/lib/interactors/approves/reject.js', /resolveActingUser\(\s*this\s*,\s*apiUser\s*\)/]
];

describe('interactors resolve the acting user through the guard', () => {
  it.each(ACTING_USER_SITES)('%s', (rel, callPattern) => {
    const source = read(rel);
    expect(source).toMatch(/import\s*\{[^}]*\bresolveActingUser\b[^}]*\}\s*from\s*'\/imports\/server\/security\/actingUser'/);
    expect(source).toMatch(callPattern);
    // The old "trust a supplied user object" pattern is gone.
    expect(source).not.toMatch(/(params\.user|authOptions\s*&&\s*authOptions\.user|apiUser|userParam)\s*\|\|\s*await\s+Meteor\.userAsync\(\)/);
  });

  it('analyzeModule resolves the acting user through the guard', () => {
    const source = read('imports/server/collections/modules.js');
    expect(source).toMatch(/import\s*\{[^}]*\bresolveActingUser\b[^}]*\}\s*from\s*'\/imports\/server\/security\/actingUser'/);
    const start = source.indexOf('analyzeModule: async function');
    const body = source.slice(start, source.indexOf('\n  },', start));
    expect(body).toMatch(/resolveActingUser\(\s*this\s*,\s*userData\s*\)/);
    expect(body).not.toMatch(/userData\s*\|\|\s*await\s+Meteor\.userAsync\(\)/);
  });
});

describe('company-scoped scan reads refuse a caller with no company', () => {
  const scans = read('imports/server/collections/scans.js');
  const analysis = read('imports/server/collections/analysis.js');

  it('Scans.Find and Scans.FindOne throw when the caller has no company and strip operators', () => {
    for (const method of ['Scans.Find', 'Scans.FindOne']) {
      const start = scans.indexOf(`'${method}'`);
      const body = scans.slice(start, scans.indexOf('\n    }', start + 20));
      expect(body).toMatch(/throw new Meteor\.Error\(\s*403/);
      expect(body).toMatch(/stripDangerousOperators/);
      // The bare "companyId = getCompanyIdForUserAsync(...)" with no guard is gone.
      expect(body).not.toMatch(/selector\.companyId = await Utils\.getCompanyIdForUserAsync\(this\.userId\)\s*\n\s*return/);
    }
    expect(scans).toMatch(/import\s*\{[^}]*\bstripDangerousOperators\b[^}]*\}\s*from\s*'\/imports\/lib\/security\/sanitizeQuery'/);
  });

  it('findOneModuleAnalysis throws when a DDP caller has no company', () => {
    const start = analysis.indexOf('findOneModuleAnalysis');
    const body = analysis.slice(start, analysis.indexOf('\n  }', start));
    expect(body).toMatch(/this\.userId/);
    expect(body).toMatch(/throw new Meteor\.Error\(\s*403/);
  });
});

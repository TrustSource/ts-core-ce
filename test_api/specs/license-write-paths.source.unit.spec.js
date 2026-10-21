/* eslint-disable no-undef */
// The license catalog is written only through Licenses.Create / Licenses.Update.
// Meteor methods cannot run under Jest (`yarn meteor-test` is broken), so the gate
// order and the absence of every older write path are locked on the source.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (/\.(js|html)$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('the old license write paths are gone', () => {
  const source = live('imports/server/collections/licenses.js');

  it.each(['Licenses.allow(', '_updateLicense', 'copyLicenseConstraints', 'removeLicense'])(
    'imports/server/collections/licenses.js has no %s', (token) => {
      expect(source).not.toContain(token);
    });

  it('no client file writes the Licenses collection directly', () => {
    const offenders = walk('imports/client', []).filter((rel) =>
      /\bLicenses\.(insert|update|remove|upsert)(Async)?\(/.test(live(rel)));
    expect(offenders).toEqual([]);
  });
});

describe('the new methods are registered', () => {
  const source = live('imports/startup/server/licenses.js');

  it.each([["'Licenses.Create'", 'LicensesCreate'], ["'Licenses.Update'", 'LicensesUpdate']])(
    'registers %s', (name, handler) => {
      expect(source).toMatch(new RegExp(name.replace(/\./g, '\\.') + ':\\s*' + handler));
    });
});

describe.each([
  ['imports/lib/interactors/licenses/create.js', 'Licenses.insertAsync('],
  ['imports/lib/interactors/licenses/update.js', 'Licenses.updateAsync(']
])('%s', (rel, write) => {
  const source = live(rel);

  it('checks the editor role before anything else', () => {
    const role = source.indexOf('Roles.userIsInRole(user, LICENSE_EDITOR_ROLES, companyId)');
    expect(role).toBeGreaterThan(-1);
    expect(role).toBeLessThan(source.indexOf('validateLicenseInput('));
    expect(role).toBeLessThan(source.indexOf(write));
  });

  it('validates before writing', () => {
    expect(source.indexOf('validateLicenseInput(')).toBeLessThan(source.indexOf(write));
  });

  it('re-primes the license cache after writing', () => {
    expect(source.indexOf('await LicensesService.init()')).toBeGreaterThan(source.indexOf(write));
  });
});

describe('create refuses a key that exists in any case', () => {
  const source = live('imports/lib/interactors/licenses/create.js');

  it('looks the key up case-insensitively before inserting', () => {
    const lookup = source.indexOf('sameKeyPattern(doc.key)');
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(source.indexOf('Licenses.insertAsync('));
  });

  it('maps a duplicate-key race onto the same message', () => {
    expect(source).toMatch(/11000/);
    expect(source).toMatch(/DUPLICATE_KEY_MESSAGE/);
  });
});

describe('update can only touch the editable fields', () => {
  const source = live('imports/lib/interactors/licenses/update.js');

  it('validates in update mode and unsets cleared fields', () => {
    expect(source).toMatch(/validateLicenseInput\(input, 'update'\)/);
    expect(source).toMatch(/\$unset/);
  });
});

describe.each([
  ['imports/lib/interactors/licenses/create.js', 'Licenses.insertAsync('],
  ['imports/lib/interactors/licenses/update.js', 'Licenses.updateAsync(']
])('%s refuses a clashing identifier', (rel, write) => {
  const source = live(rel);

  it('checks findIdentifierClash after validating and before the write', () => {
    const clashAt = source.indexOf('findIdentifierClash(');
    expect(clashAt).toBeGreaterThan(-1);
    expect(clashAt).toBeGreaterThan(source.indexOf('validateLicenseInput('));
    expect(clashAt).toBeLessThan(source.indexOf(write));
  });
});

describe('imports/lib/interactors/licenses/update.js excludes itself from the clash check', () => {
  const source = live('imports/lib/interactors/licenses/update.js');

  it('fetches the others with $ne: license._id', () => {
    expect(source).toMatch(/\$ne: license\._id/);
  });
});

describe('Licenses.Create / Licenses.Update are rate-limited', () => {
  const source = live('imports/startup/server/rate-limit.js');

  it('adds a per-connection rule and a per-user rule', () => {
    const pattern = /name === 'Licenses\.Create' \|\| name === 'Licenses\.Update'/g;
    const matches = source.match(pattern) || [];
    expect(matches.length).toBe(2);
    const firstMatch = source.search(pattern);
    expect(firstMatch).toBeGreaterThan(-1);
    expect(source.indexOf('connectionId() { return true; }', firstMatch)).toBeGreaterThan(firstMatch);
    expect(source.indexOf("userId(userId) { return !!userId; }", firstMatch)).toBeGreaterThan(firstMatch);
  });
});

describe('the interactors never reach the browser bundle', () => {
  it('no client file imports the licenses interactors', () => {
    const offenders = walk('imports/client', []).filter((rel) =>
      /imports\/lib\/interactors\/licenses/.test(live(rel)));
    expect(offenders).toEqual([]);
  });
});

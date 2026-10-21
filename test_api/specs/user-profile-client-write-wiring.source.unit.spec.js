/* eslint-disable no-undef */
// Wiring guard for the Meteor.users client-write deny rule.
//
// The predicate itself is covered by user-profile-client-write.unit.spec.js, but
// it protects nothing unless the server registers it. Meteor's allow/deny cannot
// be exercised from Jest, so the registration is locked structurally, and the
// client code that writes a user document directly is held to the allowlist so a
// new client write cannot silently start failing against the deny rule.
//
// Source-assertion pattern: the source files are read as strings.
const fs = require('fs');
const path = require('path');
const {CLIENT_WRITABLE_PROFILE_FIELDS} = require('../../imports/lib/interactors/users/protectedProfileFields');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comment-blind assertions would happily pass on a commented-out registration.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function listJs(dir) {
  const out = [];
  (function walk(current) {
    fs.readdirSync(current, {withFileTypes: true}).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.spec.js')) {
        out.push(full);
      }
    });
  })(dir);
  return out;
}

describe('Meteor.users client-write deny rule wiring', () => {
  const users = stripComments(read('imports/server/collections/users.js'));

  it('imports the guard into the users collection server file', () => {
    expect(users).toMatch(
      /import\s*\{[^}]*\bdeniesClientProfileWrite\b[^}]*\}\s*from\s*'\/imports\/lib\/interactors\/users\/protectedProfileFields'/
    );
  });

  it('registers Meteor.users.deny({update}) that delegates to the guard with the modifier', () => {
    expect(users).toMatch(
      /Meteor\.users\.deny\(\{[\s\S]*?update\s*:\s*function\s*\(\s*userId\s*,\s*doc\s*,\s*fieldNames\s*,\s*modifier\s*\)\s*\{\s*return\s+deniesClientProfileWrite\(\s*userId\s*,\s*doc\s*,\s*fieldNames\s*,\s*modifier\s*\)/
    );
  });

  it('keeps every direct client write to a user document inside the allowlist', () => {
    const clientFiles = listJs(path.join(REPO, 'imports/client'));
    const writes = [];
    clientFiles.forEach((file) => {
      stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line) => {
        if (/Meteor\.users\.update(Async)?\(/.test(line)) {
          writes.push({file: path.relative(REPO, file), line});
        }
      });
    });
    // The account-activation page is the one known direct write; if it moves or
    // a new one appears, this list and the allowlist must be revisited together.
    expect(writes.map((w) => w.file)).toEqual(['imports/client/ui/account/signup.js']);
    writes.forEach(({line}) => {
      const keys = line.match(/'profile\.[A-Za-z0-9_.]+'/g) || [];
      expect(keys.length).toBeGreaterThan(0);
      keys.map((k) => k.slice(1, -1)).forEach((key) => {
        expect(CLIENT_WRITABLE_PROFILE_FIELDS).toContain(key);
      });
    });
  });
});

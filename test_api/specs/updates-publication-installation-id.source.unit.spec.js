/* eslint-disable no-undef */
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

function publicationBody(source, name) {
  const start = source.indexOf(`Meteor.publish('${name}'`);
  if (start === -1) { return null; }
  const next = source.indexOf('Meteor.publish(', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('updates publications', () => {
  const source = live('imports/server/collections/updates.js');

  it.each(['updates', 'updatesLatest'])('%s does not publish installationId', (name) => {
    const body = publicationBody(source, name);
    expect(body).not.toBeNull();
    const finds = body.match(/Updates\.find\([\s\S]*?\);/g) || [];
    expect(finds.length).toBeGreaterThan(0);
    finds.forEach((call) => {
      expect(call).toMatch(/fields:\s*UPDATES_PUBLIC_FIELDS/);
    });
  });

  it('the shared projection excludes installationId', () => {
    expect(source).toMatch(/const UPDATES_PUBLIC_FIELDS = \{[^}]*installationId:\s*0[^}]*\}/);
  });

  it('the server-side version check still reads installationId', () => {
    expect(live('imports/startup/server/releaseNotes.js'))
      .toMatch(/Updates\.findOneAsync\(\{installationId: \{\$exists: true\}\}, \{fields: \{installationId: 1\}\}\)/);
  });
});

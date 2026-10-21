/* eslint-disable no-undef */
// Trademarks are read-only in the Community Edition: the registry is a static list
// shipped in code and forced into the database on every start. Every logged-in user
// may read it; nobody may write it from a client.
//
// Publications, allow rules and startup code cannot run under Jest, so this locks
// the source.
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

const source = live('imports/server/collections/trademarks.js');

describe('trademark reads require a logged-in user', () => {
  it('the trademarks publication readies for an anonymous subscriber', () => {
    const pub = source.slice(source.indexOf("Meteor.publish('trademarks'"), source.indexOf('export let RawTrademarks'));
    expect(pub).toMatch(/if\s*\(\s*user\s*\)/);
    expect(pub).toMatch(/this\.ready\(\)/);
  });

  it('there is no other trademark publication', () => {
    expect(source.match(/Meteor\.publish\(/g)).toHaveLength(1);
  });
});

describe('trademarks cannot be written from a client', () => {
  it('has no allow rule and no method', () => {
    expect(source).not.toMatch(/Trademarks\.allow\(/);
    expect(source).not.toMatch(/Meteor\.methods\(/);
  });

  it('the remove method and the management pages are gone', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/startup/server/trademarks.js'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'imports/lib/interactors/trademarks'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'imports/client/ui/trademarks'))).toBe(false);
    expect(live('imports/startup/server/index.js')).not.toMatch(/'\.\/trademarks'/);
    expect(live('imports/startup/client/index.js')).not.toMatch(/ui\/trademarks'/);
    const router = live('imports/lib/router.js');
    expect(router).not.toContain("name: 'trademarks'");
    expect(router).not.toContain("name: 'trademarksDetails'");
    expect(router).toContain("name: 'copyrightTrademarks'");
  });
});

describe('the shipped entries are forced on every start', () => {
  it('upserts every planned entry at startup', () => {
    expect(source).toMatch(/import \{trademarkUpserts\} from '\/imports\/server\/trademarks\/trademarksData'/);
    const startup = source.slice(source.indexOf('Meteor.startup('));
    expect(startup).toMatch(/for \(const \{selector, modifier\} of trademarkUpserts\(\)\)/);
    expect(startup).toMatch(/Trademarks\.upsertAsync\(selector, modifier\)/);
  });

  it('never deletes stored trademarks', () => {
    expect(source).not.toMatch(/Trademarks\.remove(Async)?\(/);
  });
});

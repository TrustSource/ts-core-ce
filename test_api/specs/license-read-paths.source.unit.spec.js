/* eslint-disable no-undef */
// Licenses leave the server only through licenseProjection. Publications, methods
// and the REST lookup cannot run under Jest, so the wiring is locked on the source.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

// Line comments first, then block comments: a trailing `/**` inside a line comment
// must not open a block.
function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('license publications and methods project through the allow-list', () => {
  const source = live('imports/server/collections/licenses.js');

  it('imports licenseProjection', () => {
    expect(source).toMatch(/import \{licenseProjection\} from '\/imports\/lib\/licenses\/licenseFields'/);
  });

  it('the licenses publication sends text only when not limited', () => {
    const pub = source.slice(source.indexOf("Meteor.publish('licenses'"), source.indexOf("Meteor.publish('licenseDetail'"));
    expect(pub).toMatch(/fields: licenseProjection\(\{withText: !limited\}\)/);
    expect(pub).not.toMatch(/text: ?0/);
  });

  it('the licenseDetail publication projects', () => {
    const start = source.indexOf("Meteor.publish('licenseDetail'");
    const pub = source.slice(start, source.indexOf('Meteor.methods(', start));
    expect(pub).toMatch(/fields: licenseProjection\(\{withText: true\}\)/);
  });

  it('getLicenseDetails projects', () => {
    const method = source.slice(source.indexOf('getLicenseDetails:'), source.indexOf('getLicenseByNameOrKeyOrAlias:'));
    expect(method).toMatch(/fields: licenseProjection\(\{withText: true\}\)/);
  });
});

describe('Licenses.search', () => {
  const source = live('imports/lib/interactors/licenses/search.js');

  it('projects list fields', () => {
    expect(source).toMatch(/const LIST_FIELDS = licenseProjection\(\{withText: false\}\)/);
  });

  it('sets the projection after the caller options, so a DDP client cannot override it', () => {
    const options = source.slice(source.indexOf('const getOptions'), source.indexOf('const localSearch'));
    expect(options.indexOf('...options')).toBeGreaterThan(-1);
    expect(options.indexOf('fields: LIST_FIELDS')).toBeGreaterThan(options.indexOf('...options'));
  });

  it('the paged query projects too', () => {
    expect(source).toMatch(/\{sort: \{name: 1\}, skip, limit, fields: LIST_FIELDS\}/);
  });
});

describe('the license cache carries no assessment state', () => {
  it('imports/api/licenses.js never reads analysed', () => {
    expect(live('imports/api/licenses.js')).not.toMatch(/analysed/);
  });
});

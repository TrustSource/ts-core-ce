/* eslint-disable no-undef */
// The internal component, COTS, infrastructure component and license REST
// endpoints (guarded by INTERNAL_API_KEY) are gone, along with the crawler
// update path they served.
const fs = require('fs');
const path = require('path');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const REPO = path.join(__dirname, '../..');

const ROUTES = [
  'imports/server/rest-api/components.js',
  'imports/server/rest-api/cotsComponents.js',
  'imports/server/rest-api/infrastructureComponents.js',
  'imports/server/rest-api/licenses.js'
];

describe('no INTERNAL_API_KEY endpoints remain', () => {
  it.each(ROUTES)('%s is deleted', (rel) => {
    expect(fs.existsSync(path.join(REPO, rel))).toBe(false);
  });

  it('no route file is registered', () => {
    const source = readSourceWithoutComments('imports/startup/server/register-restapi.js');
    ROUTES.forEach((rel) => expect(source).not.toContain(rel));
  });

  it('server config has no INTERNAL_API_KEY setting', () => {
    expect(readSourceWithoutComments('imports/server/config.js')).not.toMatch(/INTERNAL_API_KEY/);
  });

  it('RestApi has no internal key check or crawler update helpers', () => {
    const source = readSourceWithoutComments('imports/server/rest-api/RestApi.js');
    expect(source).not.toMatch(/INTERNAL_API_KEY|getMetaByApiKey|getModifierForUpdate|getFilterConfig/);
  });

  it('Components.Create takes no API key context', () => {
    const source = readSourceWithoutComments('imports/lib/interactors/components/create.js');
    expect(source).not.toMatch(/keyMeta/);
  });
});

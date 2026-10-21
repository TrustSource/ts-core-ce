/* eslint-disable no-undef */
// The Community Edition carries no legal assessment of licenses: no constraints, no
// analysed state, no internal remarks, and none of the tooling that maintained them.
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

describe('the license schema is catalog metadata only', () => {
  const source = live('imports/lib/schemas/licenseSchema.js');

  it.each(['constraints', 'constraintsSettings', 'LicenseLegalSettingsEntry', 'analysed', 'editorial', 'disclaimer'])(
    'declares no %s', (token) => {
      expect(source).not.toContain(token);
    });

  it.each(['key:', 'name:', 'url:', 'created:', 'updated:', 'text:', 'aliases:', 'copyright:'])(
    'still declares %s', (token) => {
      expect(source).toContain(token);
    });
});

describe('the assessment tooling is gone', () => {
  it('the constraints collapse autoform template is deleted and not imported', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/client/ui/common/afObjectField-collapse.html'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'imports/client/ui/common/afObjectField-collapse.js'))).toBe(false);
    expect(live('imports/client/ui/common/index.js')).not.toMatch(/afObjectField-collapse/);
  });

  it('the check-service reload method is gone', () => {
    expect(live('imports/startup/server/ts-check.js')).not.toMatch(/ecsCheckReload/);
  });

  it('the Check page lists every license instead of the analysed ones', () => {
    expect(live('imports/client/ui/check/check-license.js')).not.toMatch(/analysed/);
  });

  it('the copyleft mongo-update script is deleted', () => {
    expect(fs.existsSync(path.join(REPO, 'tests/mongo-updates/22-get-copyleft-licenses.js'))).toBe(false);
  });
});

describe('the startup seed writes no assessment data', () => {
  const source = live('imports/startup/server/fixtures.js');

  it('never mentions constraints or analysed', () => {
    expect(source).not.toMatch(/constraints|analysed/);
  });

  // The seed inserts by key and is allowed exactly one update: filling a license text
  // the catalog never received, because the insert was skipped on a taken key. It must
  // stay that narrow - a text a user wrote or cleared is never overwritten, and no
  // other field is ever written to an existing license.
  it('only ever fills a license text that is missing', () => {
    const updates = source.match(/Licenses\.updateAsync\([\s\S]*?\n\s*\);/g) || [];
    expect(updates).toHaveLength(1);
    const [update] = updates;
    // the selector refuses a row that already has a text
    expect(update).toMatch(/text:\s*\{\$exists:\s*false\}/);
    expect(update).toMatch(/\{text:\s*null\}/);
    expect(update).toMatch(/\{text:\s*''\}/);
    // and the modifier writes nothing but the text
    expect(update).toMatch(/\$set:\s*\{text:\s*fill\.text\}/);
  });

  it('never upserts or multi-updates a license', () => {
    expect(source).not.toMatch(/Licenses\.updateAsync\([\s\S]*?(upsert|multi)/);
  });
});

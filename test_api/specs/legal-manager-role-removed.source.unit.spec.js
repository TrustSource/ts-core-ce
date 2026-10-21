/* eslint-disable no-undef */
// The internal legal_manager role does not exist in the Community Edition. Nothing in
// the application, its tools, fixtures or role documentation may name it.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (/\.(js|mjs|html|md)$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('legal_manager is gone', () => {
  it('no application, tool or fixture file names it', () => {
    const files = ['imports', 'tools', 'tests']
      .filter((dir) => fs.existsSync(path.join(REPO, dir)))
      .reduce((all, dir) => walk(dir, all), [])
      .concat(['ROLES_AND_PERMISSIONS.md']);
    const offenders = files.filter((rel) => /legal_manager/.test(fs.readFileSync(path.join(REPO, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is not a canonical role', () => {
    const seed = fs.readFileSync(path.join(REPO, 'imports/startup/server/roles-seed.js'), 'utf8');
    expect(seed).not.toMatch(/legal_manager/);
  });
});

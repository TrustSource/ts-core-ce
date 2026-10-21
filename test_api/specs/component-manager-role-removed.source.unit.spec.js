/* eslint-disable no-undef */
// The internal component_manager role is gone from code; company_component_manager
// holds the whole component catalog capability.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.(js|mjs|html|md)$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('component_manager is gone', () => {
  it('no application, tool, fixture or role doc names it', () => {
    const files = ['imports', 'tools', 'tests']
      .filter((dir) => fs.existsSync(path.join(REPO, dir)))
      .reduce((all, dir) => walk(dir, all), [])
      .concat(['ROLES_AND_PERMISSIONS.md']);
    const offenders = files.filter((rel) =>
      /(^|[^_a-z])component_manager\b/.test(fs.readFileSync(path.join(REPO, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('company_component_manager gates the component catalog methods', () => {
    const cots = fs.readFileSync(path.join(REPO, 'imports/startup/server/cotsComponents.js'), 'utf8');
    const infra = fs.readFileSync(path.join(REPO, 'imports/startup/server/infrastructureComponents.js'), 'utf8');
    expect(cots).toMatch(/'company_component_manager'/);
    expect(infra).toMatch(/'company_component_manager'/);
  });
});

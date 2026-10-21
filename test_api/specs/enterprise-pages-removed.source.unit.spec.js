/* eslint-disable no-undef */
// The Enterprise companies pages are gone, and so is the enterprise_admin role:
// every right it still had was shared with account_admin.
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
    } else if (entry.isFile() && /\.(js|mjs|html|md)$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

describe('enterprise companies pages', () => {
  it('the UI directory is deleted and not imported', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/client/ui/enterprise-manager'))).toBe(false);
    expect(live('imports/startup/client/index.js')).not.toMatch(/enterprise-manager/);
  });

  it('routes, menu entry and publications are gone', () => {
    expect(live('imports/lib/router.js')).not.toMatch(/enterpriseCompanyList|\/enterprise\/companies/);
    expect(live('imports/client/ui/common/navigation.js')).not.toMatch(/enterpriseCompanyList/);
    expect(live('imports/server/collections/companies.js')).not.toMatch(/publish\('(enterpriseCompanyList|companyDetails)'/);
  });

  it('enterprise_admin is no longer defined, seeded, checked or documented', () => {
    const files = ['imports', 'tools', 'tests']
      .filter((dir) => fs.existsSync(path.join(REPO, dir)))
      .reduce((all, dir) => walk(dir, all), [])
      .concat(['ROLES_AND_PERMISSIONS.md', 'public/api-v2/openapi.yaml']);
    const offenders = files.filter((rel) =>
      /enterprise_admin/.test(fs.readFileSync(path.join(REPO, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the integrations settings are gated on account_admin alone', () => {
    expect(live('imports/lib/router.js')).toMatch(/requireRole\.call\(this, \['account_admin'\]\);\s*\}, \{\s*only: \['companyIntegrations'/);
    ['updateJira', 'updateTfs', 'updateGithub', 'updateScanoss'].forEach((name) => {
      expect(live('imports/lib/interactors/companies/' + name + '.js')).toMatch(/Roles\.userIsInRole\(user, \['account_admin'\]/);
    });
  });
});

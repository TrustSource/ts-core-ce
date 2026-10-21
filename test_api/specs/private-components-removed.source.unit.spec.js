/* eslint-disable no-undef */
// Components are shared by the whole installation: nothing marks, filters or
// scopes a component by company.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '');
}

function walk(dir, out) {
  fs.readdirSync(path.join(REPO, dir), {withFileTypes: true}).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel, out);
    } else if (entry.isFile() && /\.(js|html)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

const FILES = walk('imports', []).filter((rel) => rel !== 'imports/lib/interactors/vulnerabilityAlerts/sweep.js');

describe('private components are gone', () => {
  it.each([
    ['companyIds', /\bcompanyIds\b/],
    ['private helpers', /\bisPrivate\(|\bmakePublic\(|\bsetCompanyId\(|\bgetCompanyIds\(/],
    ['scope clause', /companyRestriction|buildScopeClause|buildInternalSelector/],
    ['internal lake mode', /componentLakeInternal|component-lake-internal/]
  ])('%s', (label, pattern) => {
    expect(FILES.filter((rel) => pattern.test(live(rel)))).toEqual([]);
  });

  it('the scope filter module is deleted', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/lib/component/componentScopeFilter.js'))).toBe(false);
  });
});

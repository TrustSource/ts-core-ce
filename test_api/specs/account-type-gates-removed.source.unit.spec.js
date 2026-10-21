/* eslint-disable no-undef */
// No code reads the company account type: private licenses and private algorithms
// work for every company.
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

describe('no account type gate remains', () => {
  it('nothing compares an account type to enterprise', () => {
    const offenders = walk('imports', [])
      .filter((rel) =>
        /accountType\s*[!=]==?\s*['"]enterprise['"]|['"]enterprise['"]\s*[!=]==?\s*[\w.]*accountType/.test(live(rel)));
    expect(offenders).toEqual([]);
  });

  it('private license and algorithm methods no longer refuse with 402', () => {
    expect(live('imports/server/collections/companies.js')).not.toMatch(/\b402\b|FEATURE_NA/);
  });
});

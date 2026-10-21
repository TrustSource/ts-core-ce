/* eslint-disable no-undef */
// Integrations are available to every company: nothing asks the plan whether Jira,
// TFS, GitHub or LeanIX (or their per-project variants) are allowed.
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

const FILES = walk('imports', []);

describe('no plan-based integration gate remains', () => {
  it.each([
    ['isFeatureAllowedByPlan', /isFeatureAllowedByPlan/],
    ['plan integration keys', /['"](multi_)?(jira|tfs|github|leanix)_integration['"]/],
    ['account type notices', /(corporate|enterprise) account type/i]
  ])('%s', (label, pattern) => {
    expect(FILES.filter((rel) => pattern.test(live(rel)))).toEqual([]);
  });

  it.each([
    'imports/lib/interactors/projects/getJiraCredentials.js',
    'imports/lib/interactors/projects/getTfsCredentials.js',
    'imports/lib/interactors/projects/getGithubCredentials.js'
  ])('%s never consults the plan', (rel) => {
    expect(live(rel)).not.toMatch(/Plan|plan/);
  });
});

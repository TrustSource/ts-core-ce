/* eslint-disable no-undef */
// The API keys list wraps its table in {{#with getApiKeys}}. Blaze treats an empty array as
// falsy, so an empty company had no `{{else}}` branch and rendered nothing instead of the
// standard empty-list state.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const TEMPLATE = 'imports/client/ui/settings/api/company-api-keys.html';

function live(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '');
}

function withBlock(source) {
  const start = source.indexOf('{{#with getApiKeys}}');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('{{/with}}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + '{{/with}}'.length);
}

describe('API keys list empty state', () => {
  it('the getApiKeys block renders the standard empty state on the else branch', () => {
    const block = withBlock(live(TEMPLATE));
    expect(block).toMatch(/\{\{else\}\}/);
    expect(block).toMatch(/\{\{>\s*reactiveTableNoData\s*\}\}/);
  });

  it('positive anchor: the reactiveTable include is still there', () => {
    const block = withBlock(live(TEMPLATE));
    expect(block).toMatch(/\{\{>\s*reactiveTable\s+settings=reactiveTableSettings/);
  });
});

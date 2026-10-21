/* eslint-disable no-undef */
// AGPL-3.0 section 13: users interacting with the app over a network must be
// offered its source. Both footers (signed in and on the sign-in pages) link to it.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

describe('AGPL source link', () => {
  it('points the source URL at the public CE repository', () => {
    expect(read('imports/config.js')).toContain("sourceUrl: 'https://github.com/TrustSource/ts-core-ce'");
  });

  it.each([
    'imports/client/ui/common/navigation.html',
    'imports/client/ui/layouts/blank-layout.html'
  ])('shows the source link in %s', (file) => {
    expect(read(file)).toContain('<a href="{{app \'sourceUrl\'}}" target="_blank" rel="noopener">Source code (AGPL-3.0)</a>');
  });

  it('ships under AGPL-3.0-only', () => {
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-only');
    expect(read('LICENSE')).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
  });
});

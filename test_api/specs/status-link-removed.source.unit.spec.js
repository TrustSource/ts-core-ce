/* eslint-disable no-undef */
// The Community Edition has no hosted status page: neither the right-hand icon bar nor
// the sign-in page footer links to status.trustsource.io.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

describe('status page link', () => {
  it.each([
    'imports/config.js',
    'imports/client/ui/common/right-bar.html',
    'imports/client/ui/common/right-bar.js'
  ])('%s has no status link', (rel) => {
    const source = read(rel);
    expect(source).not.toMatch(/status\.trustsource\.io/);
    expect(source).not.toMatch(/statusUrl/);
    expect(source).not.toMatch(/Monitor system health/);
  });

  it('the sign-in footer still shows the app name and version', () => {
    expect(read('imports/config.js')).toMatch(/Config\.footer1 = '<strong>' \+ Config\.name \+ ' ' \+ Config\.version/);
  });
});

/* eslint-disable no-undef */
// intro.js 2.x is AGPL-3.0 or commercial and was replaced by the own guide panel
// and tour (imports/client/ui/common/guide/). Keep it from coming back as a
// dependency or an import.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function sources(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(js|html|less|css)$/.test(entry.name) ? [full] : [];
  });
}

describe('intro.js is not used', () => {
  it('is not an npm dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies))).not.toContain('intro.js');
  });

  it('is not a Meteor package', () => {
    expect(read('.meteor/packages')).not.toMatch(/introjs/);
    expect(fs.existsSync(path.join(root, 'packages/introjs'))).toBe(false);
  });

  it('is not imported or styled anywhere in the client', () => {
    const offenders = sources(path.join(root, 'imports/client'))
      .filter((file) => /from ['"](intro\.js|meteor\/rexzh0u:introjs)['"]|\.introjs-|introJs\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});

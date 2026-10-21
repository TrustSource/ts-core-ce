/* eslint-disable no-undef */
// This installation's own settings all carry the TS_ prefix. Three predate it
// and were named ECS_ after an earlier product; they were renamed with no
// fallback, so an instance still setting the old name gets "not set" rather
// than a silently different behaviour.
//
// ECS_CHECK_SERVER was also the key the analysis worker reads out of the
// settings object the runner hands it - not only an environment variable - so
// the rename had to carry through workerRunner into workers/analysis.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');

function walk(dir, acc) {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') { continue; }
      walk(rel, acc);
    } else if (/\.(js|mjs|cjs|yml|yaml|sh|md|example)$/.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

const SELF = 'test_api/specs/env-naming.source.unit.spec.js';

// This file names the old settings in its own comments, so it scans everything
// except itself.
const TREE = ['imports', 'server', 'client', 'packages', 'tools', 'docker', 'workers', 'test_api']
  .reduce((acc, dir) => walk(dir, acc), [])
  .concat(['docker-compose.yml', 'Readme.md', '.env.example'])
  .filter((rel) => rel !== SELF);

describe('settings are named TS_, not ECS_', () => {
  it('finds files to check at all', () => {
    expect(TREE.length).toBeGreaterThan(100);
  });

  it('no file mentions an ECS_ setting', () => {
    const offenders = TREE.filter((rel) => /\bECS_[A-Z_]+/.test(fs.readFileSync(path.join(root, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['TS_CHECK_SERVER', 'imports/server/config.js']
  ])('%s is read', (name, file) => {
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toMatch(new RegExp(`process\\.env\\.${name}\\b`));
  });

  // The SPDX tag-value / spreadsheet import needed an external SPDX-tools service to
  // convert those formats to RDF. The Community Edition imports RDF directly, so the
  // service and both its settings are gone; nothing may reintroduce them.
  it.each(['TS_SPDX_SERVICE_SERVER', 'TS_SPDX_SERVICE'])('%s is read nowhere', (name) => {
    const offenders = TREE.filter((rel) => fs.readFileSync(path.join(root, rel), 'utf8').includes(name));
    expect(offenders).toEqual([]);
  });

  it('the worker receives the check server under the new key', () => {
    expect(fs.readFileSync(path.join(root, 'imports/server/workerRunner/index.js'), 'utf8'))
      .toMatch(/TS_CHECK_SERVER: Config\.TS_CHECK_SERVER/);
    expect(fs.readFileSync(path.join(root, 'workers/analysis/services/TSCheck.js'), 'utf8'))
      .toMatch(/getSettings\(\)\.TS_CHECK_SERVER/);
  });

  it('the reference compose file sets the new name', () => {
    expect(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'))
      .toMatch(/^ +- TS_CHECK_SERVER=/m);
  });
});

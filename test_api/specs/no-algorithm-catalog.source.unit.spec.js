/* eslint-disable no-undef */
// The global algorithm catalog is gone from the Community Edition.
//
// It was a read-only reference list (name, strength, broken date, PQC status,
// substitutes) behind Knowledge > Algorithms, populated from the hosted
// database. Nothing in this repo ever seeded it, so on a self-hosted install the
// collection was permanently empty: the page listed nothing and the two methods
// that merged it into the crypto pickers contributed nothing.
//
// The pickers stay. They now read `company.privateAlgorithms` alone, which in a
// CE installation was already their only source.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const {readSourceWithoutComments} = require('../helpers/loadMeteorModule');

const DELETED = [
  'imports/client/ui/algorithms',
  'imports/client/ui/common/algorithms-list-filter',
  'imports/lib/collections/algorithms.js',
  'imports/server/collections/algorithms.js',
  'public/cryptographic_algorithms.json',
  'public/cryptographic_algorithms_v2.json'
];

// What the pickers still need - deleting these would take crypto with it.
const KEPT = [
  // AlgorithmsConfig only - the crypto policy shape on company, project and
  // module. The catalog collection never had a schema of its own.
  'imports/lib/schemas/algorithmsSchema.js',
  'imports/client/ui/common/algorithms-list',
  'imports/client/ui/common/algorithms-settings-add-modal',
  'imports/client/ui/common/algorithms-settings-policy-add-modal',
  'imports/client/ui/common/algorithms-issues-link',
  'imports/client/ui/settings/policies/company-crypto-algorithms.js',
  'imports/client/ui/settings/templates/company-private-algorithms.js',
  'imports/client/ui/reports/report-algorithms',
  'imports/client/ui/reports/report-bad-algorithms',
  'imports/client/ui/reports/report-impact-algorithm'
];

describe('the algorithm catalog is gone', () => {
  it.each(DELETED)('%s no longer exists', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(false);
  });

  it('nothing imports the collection any more', () => {
    const grep = require('child_process').spawnSync('grep', [
      '-rl', '--exclude-dir=node_modules', '-e', 'collections/algorithms',
      'imports', 'server', 'client'
    ], {cwd: root, encoding: 'utf8'});
    expect(grep.stdout.trim()).toBe('');
  });

  it('Knowledge no longer offers an Algorithms entry', () => {
    expect(readSourceWithoutComments('imports/client/ui/common/navigation.js'))
      .not.toMatch(/algorithmList/);
  });

  it('neither algorithm route is registered', () => {
    const router = readSourceWithoutComments('imports/lib/router.js');
    expect(router).not.toMatch(/'algorithmList'/);
    expect(router).not.toMatch(/'algorithmDetail'/);
  });

  it('the client no longer loads the page', () => {
    expect(readSourceWithoutComments('imports/startup/client/index.js'))
      .not.toMatch(/ui\/algorithms/);
  });
});

describe('the crypto pickers keep working off the company list', () => {
  it.each(KEPT)('%s is still there', (rel) => {
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
  });

  it('getAlgorithms and findAlgorithms read only privateAlgorithms', () => {
    const src = readSourceWithoutComments('imports/server/collections/companies.js');
    expect(src).toMatch(/'getAlgorithms':/);
    expect(src).toMatch(/'findAlgorithms':/);
    expect(src).not.toMatch(/Algorithms\.find\(/);
    expect(src).toMatch(/privateAlgorithms/);
  });
});

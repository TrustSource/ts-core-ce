/* eslint-disable no-undef */
// A fresh Community Edition install ships 21 popular licenses with their full SPDX
// texts. Licenses are seeded once: a start inserts only keys that are still missing.
const fs = require('fs');
const path = require('path');
const {licensesToSeed} = require('../../imports/lib/licenses/licenseSeed');
const {validateLicenseInput} = require('../../imports/lib/licenses/licenseInput');

const DATA_PATH = path.join(__dirname, '../../imports/server/licenses/popular-licenses.json');

const EXPECTED_KEYS = [
  'MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'BSD-2-Clause',
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-2.0-or-later', 'GPL-2.0-with-classpath-exception',
  'EPL-1.0', 'MPL-2.0', 'EPL-2.0', 'LGPL-3.0-only', 'AGPL-3.0-only', 'CC0-1.0', 'Unlicense',
  'SSPL-1.0'
];

describe('popular-licenses.json', () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  it('records where it came from', () => {
    expect(data.source).toBe('https://github.com/spdx/license-list-data');
    expect(typeof data.licenseListVersion).toBe('string');
    expect(data.licenseListVersion.length).toBeGreaterThan(0);
    expect(data.sourceTag).toMatch(/^v\d+\.\d+/);
  });

  it('carries exactly the 21 agreed licenses, in order', () => {
    expect(data.licenses.map((l) => l.key)).toEqual(EXPECTED_KEYS);
  });

  it('every entry is key, name, url and a real license text', () => {
    data.licenses.forEach((license) => {
      expect(Object.keys(license).sort()).toEqual(['key', 'name', 'text', 'url']);
      expect(license.text.length).toBeGreaterThan(200);
      expect(license.url).toMatch(/^https?:\/\//);
    });
  });

  it('every entry is something Licenses.Create would accept', () => {
    data.licenses.forEach((license) => {
      const result = validateLicenseInput(license, 'create');
      expect(result.error).toBeUndefined();
    });
  });

  it('is loaded only by server code', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../../imports/startup/server/fixtures.js'), 'utf8');
    expect(raw).toMatch(/import POPULAR_LICENSES from '\/imports\/server\/licenses\/popular-licenses\.json'/);
  });

  it('carries no leftover SPDX placeholder text', () => {
    // SPDX ships some "with-exception" records with a literal "insert ... here" line
    // instead of the base license text - GPL-2.0-with-classpath-exception is one.
    data.licenses.forEach((license) => {
      expect(license.text).not.toMatch(/insert\s.+\shere/i);
    });
  });

  it('GPL-2.0-with-classpath-exception carries the real GPL v2 text, not a placeholder', () => {
    const classpath = data.licenses.find((l) => l.key === 'GPL-2.0-with-classpath-exception');
    const gplOnly = data.licenses.find((l) => l.key === 'GPL-2.0-only');
    expect(classpath.text).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(classpath.text).toContain('Version 2, June 1991');
    // The SPDX record spells the exception heading "Class Path Exception" (two words),
    // never the single word "Classpath" - checked against the fetched text itself.
    expect(classpath.text).toContain('Class Path');
    expect(classpath.text.length).toBeGreaterThan(gplOnly.text.length);
  });
});

describe('licensesToSeed', () => {
  const ENTRIES = [
    {key: 'MIT', name: 'MIT License', url: 'https://opensource.org/licenses/MIT', text: 'mit text'},
    {key: 'Apache-2.0', name: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', text: 'apache text'}
  ];

  it('seeds everything into an empty catalog', () => {
    expect(licensesToSeed(ENTRIES, [])).toEqual(ENTRIES);
  });

  it('never touches a license whose key exists, in any case', () => {
    expect(licensesToSeed(ENTRIES, ['mit']).map((l) => l.key)).toEqual(['Apache-2.0']);
    expect(licensesToSeed(ENTRIES, ['MIT', 'APACHE-2.0'])).toEqual([]);
  });

  it('picks up an entry added to the seed later', () => {
    expect(licensesToSeed(ENTRIES, ['MIT']).map((l) => l.key)).toEqual(['Apache-2.0']);
  });

  it('does not seed the same key twice from one list', () => {
    const twice = ENTRIES.concat([{key: 'mit', name: 'x', url: 'https://x.org', text: 'x'}]);
    expect(licensesToSeed(twice, []).map((l) => l.key)).toEqual(['MIT', 'Apache-2.0']);
  });

  it('copies only catalog fields and never returns the input objects', () => {
    const withExtra = [Object.assign({constraints: {R1: true}}, ENTRIES[0])];
    const out = licensesToSeed(withExtra, []);
    expect(out[0]).toEqual(ENTRIES[0]);
    expect(out[0]).not.toBe(withExtra[0]);
  });

  it('ignores non-string existing keys', () => {
    expect(licensesToSeed(ENTRIES, [null, undefined, 42]).length).toBe(2);
  });
});

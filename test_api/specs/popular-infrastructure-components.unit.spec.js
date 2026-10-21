/* eslint-disable no-undef */
// A fresh Community Edition install ships a few common infrastructure components. They
// are seeded once: a start inserts only keys that are still missing.
const fs = require('fs');
const path = require('path');
const {infrastructureComponentsToSeed} = require('../../imports/lib/component/infrastructureComponentSeed');
const {normalizeInfrastructureComponentKey} = require('../../imports/lib/component/infrastructureComponentInput');

const DATA_PATH = path.join(__dirname, '../../imports/server/infrastructureComponents/popular-infrastructure-components.json');
const LICENSES_PATH = path.join(__dirname, '../../imports/server/licenses/popular-licenses.json');

const EXPECTED_KEYS = [
  'im:nginx', 'im:apache_http_server', 'im:mariadb', 'im:mongodb', 'im:rabbitmq', 'im:apache_kafka'
];
const URL_PATTERN = /^https:\/\/\S+$/;
// QOS.HUMAN (imports/lib/component/QOS.js): the license was set by a person, not a crawler.
const QOS_HUMAN = 3;

describe('popular-infrastructure-components.json', () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const licenses = JSON.parse(fs.readFileSync(LICENSES_PATH, 'utf8')).licenses;

  it('carries exactly the agreed components, in order', () => {
    expect(data.components.map((c) => c.key)).toEqual(EXPECTED_KEYS);
  });

  it('every key is already in its stored form', () => {
    data.components.forEach((component) => {
      expect(normalizeInfrastructureComponentKey(component.key)).toEqual({value: component.key});
    });
  });

  it('every entry has a name, description, category, language and https links', () => {
    data.components.forEach((component) => {
      expect(Object.keys(component).sort())
        .toEqual(['category', 'description', 'key', 'language', 'name', 'urls', 'versions']);
      expect(component.name.trim().length).toBeGreaterThan(0);
      expect(component.description.trim().length).toBeGreaterThan(20);
      expect(component.category.length).toBeGreaterThan(0);
      expect(component.language.length).toBeGreaterThan(0);
      expect(component.urls.homepage).toMatch(URL_PATTERN);
      expect(component.urls.repository).toMatch(URL_PATTERN);
    });
  });

  it('every version carries a license that the license seed ships, as that license names itself', () => {
    data.components.forEach((component) => {
      expect(component.versions.length).toBeGreaterThanOrEqual(2);
      component.versions.forEach((version) => {
        expect(Object.keys(version).sort()).toEqual(['licenses', 'version']);
        expect(version.licenses.length).toBe(1);
        const license = version.licenses[0];
        const seeded = licenses.find((l) => l.key === license.key);
        expect(seeded).toBeDefined();
        expect(license).toEqual({key: seeded.key, name: seeded.name, url: seeded.url, qos: QOS_HUMAN});
      });
    });
  });

  it('is loaded only by server code', () => {
    const raw = fs.readFileSync(path.join(__dirname, '../../imports/startup/server/fixtures.js'), 'utf8');
    expect(raw).toMatch(/import POPULAR_INFRASTRUCTURE_COMPONENTS from '\/imports\/server\/infrastructureComponents\/popular-infrastructure-components\.json'/);
  });
});

describe('infrastructureComponentsToSeed', () => {
  const ENTRIES = [
    {key: 'im:nginx', name: 'NGINX', urls: {homepage: 'https://nginx.org/'}, versions: [{version: '1.28.0'}]},
    {key: 'im:mongodb', name: 'MongoDB', urls: {}, versions: []}
  ];

  it('seeds everything into an empty catalog', () => {
    expect(infrastructureComponentsToSeed(ENTRIES, [])).toEqual(ENTRIES);
  });

  it('never touches a component whose key exists, in any case', () => {
    expect(infrastructureComponentsToSeed(ENTRIES, ['IM:NGINX']).map((c) => c.key)).toEqual(['im:mongodb']);
    expect(infrastructureComponentsToSeed(ENTRIES, ['im:nginx', 'im:MongoDB'])).toEqual([]);
  });

  it('does not seed the same key twice from one list', () => {
    const twice = ENTRIES.concat([{key: 'IM:NGINX', name: 'x', urls: {}, versions: []}]);
    expect(infrastructureComponentsToSeed(twice, []).map((c) => c.key)).toEqual(['im:nginx', 'im:mongodb']);
  });

  it('copies only catalog fields and never shares nested objects with the input', () => {
    const withExtra = [Object.assign({removed: true, _id: 'x'}, ENTRIES[0])];
    const out = infrastructureComponentsToSeed(withExtra, []);
    expect(out[0]).toEqual(ENTRIES[0]);
    expect(out[0].urls).not.toBe(withExtra[0].urls);
    expect(out[0].versions).not.toBe(withExtra[0].versions);
  });

  it('ignores non-string existing keys', () => {
    expect(infrastructureComponentsToSeed(ENTRIES, [null, undefined, 42]).length).toBe(2);
  });
});

// The Vulnerability Lake methods read the local OSV cache only: `cves` (one document per
// component key and version), `osvVulns` (full records) and the bundled CWE catalog.
const fs = require('fs');
const path = require('path');
const {pairId, pairFromPurl} = require('../../imports/server/osv/pairId');
const {createLakeService, searchRows, escapeRegex} = require('../../imports/server/osv/lakeService');
const {lookupCwe} = require('../../imports/server/cwe/cweCatalog');

const REPO = path.join(__dirname, '..', '..');
const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';

function matches(doc, selector) {
  return Object.keys(selector).every(function (field) {
    const condition = selector[field];
    if (field === '$or') {
      return condition.some(function (sub) { return matches(doc, sub); });
    }
    const value = doc[field];
    if (condition && typeof condition === 'object' && '$in' in condition) {
      const values = Array.isArray(value) ? value : [value];
      return values.some(function (v) { return condition.$in.indexOf(v) > -1; });
    }
    if (condition && typeof condition === 'object' && '$regex' in condition) {
      return typeof value === 'string' && new RegExp(condition.$regex).test(value);
    }
    return value === condition;
  });
}

function fakeCollection(docs) {
  const calls = [];
  return {
    calls,
    find(selector, options) {
      calls.push({selector, options});
      const limit = (options && options.limit) || Infinity;
      const found = docs.filter(function (doc) { return matches(doc, selector); }).slice(0, limit);
      return {fetchAsync: async function () { return JSON.parse(JSON.stringify(found)); }};
    },
    async findOneAsync(selector) {
      calls.push({selector});
      const found = docs.find(function (doc) { return matches(doc, selector); });
      return found ? JSON.parse(JSON.stringify(found)) : undefined;
    }
  };
}

const LODASH_ID = 'osv:d6a639ca32547f2e7cf09432475102d4b814580f';

const GHSA_35JH = {
  _id: 'GHSA-35jh-r3h4-6jhm',
  aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
  summary: 'Command Injection in lodash',
  details: 'lodash versions prior to 4.17.21 are vulnerable to Command Injection.',
  cwe_ids: ['CWE-77'],
  impact: {cvss3: {vectorString: V31, version: '3.1', baseScore: 7.2}},
  references: [],
  affected: []
};

const LODASH_DOC = {
  _id: LODASH_ID,
  key: 'npm:lodash',
  source: 'osv',
  versions: [{
    version: '4.17.20',
    checkedAt: '2026-09-18T10:00:00.000Z',
    cves: [
      {vuln_ids: ['CVE-2020-28500'], aliases: [], impact: {}, severity: 'moderate'},
      {vuln_ids: ['CVE-2021-23337'], aliases: ['GHSA-35jh-r3h4-6jhm'],
        impact: {cvss3: {vectorString: V31, version: '3.1', baseScore: 7.2}}}
    ]
  }]
};

function service() {
  const Cves = fakeCollection([LODASH_DOC, {_id: 'osv:other', key: 'npm:lodash.merge', source: 'osv',
    versions: [{version: '4.6.2', cves: []}]}]);
  const OsvVulns = fakeCollection([GHSA_35JH]);
  return {Cves, OsvVulns, lake: createLakeService({Cves, OsvVulns, lookupCwe})};
}

describe('pairId / pairFromPurl', () => {
  it('computes the same document id as the analysis worker', () => {
    // The same literal is pinned in workers/test/analysis/unit/osvQueries.test.js.
    expect(pairId('npm:lodash', '4.17.20')).toBe(LODASH_ID);
  });

  it('turns a versioned purl into a lower-cased component key and version', () => {
    expect(pairFromPurl('pkg:npm/lodash@4.17.20')).toEqual({key: 'npm:lodash', version: '4.17.20'});
    expect(pairFromPurl('pkg:npm/%40babel/core@7.0.0')).toEqual({key: 'npm:@babel:core', version: '7.0.0'});
    expect(pairFromPurl('pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1'))
      .toEqual({key: 'maven:org.apache.logging.log4j:log4j-core', version: '2.14.1'});
    expect(pairFromPurl('pkg:nuget/Newtonsoft.Json@13.0.1')).toEqual({key: 'nuget:newtonsoft.json', version: '13.0.1'});
  });

  it('answers null without a version or for a non-purl', () => {
    expect(pairFromPurl('pkg:npm/lodash')).toBeNull();
    expect(pairFromPurl('lodash')).toBeNull();
    expect(pairFromPurl({$gt: ''})).toBeNull();
  });
});

describe('cveDetails', () => {
  it('finds a record by an alias and names the result after the id asked for', async () => {
    const {lake} = service();
    const response = await lake.cveDetails(['CVE-2021-23337']);
    expect(response.statusCode).toBe(200);
    expect(response.data.cves).toHaveLength(1);
    expect(response.data.cves[0].cve_id).toBe('CVE-2021-23337');
    expect(response.data.cves[0].osv_id).toBe('GHSA-35jh-r3h4-6jhm');
    expect(response.data.cves[0].impact.cvss3.baseScore).toBe(7.2);
    expect(response.data.cves[0].weakness).toBe('CWE-77');
  });

  it('finds a GHSA typed in the wrong case under its canonical spelling', async () => {
    const {lake} = service();
    const response = await lake.cveDetails(['ghsa-35JH-R3H4-6JHM']);
    expect(response.data.cves.map(function (c) { return c.cve_id; })).toEqual(['GHSA-35jh-r3h4-6jhm']);
  });

  it('answers nothing for unknown ids and never queries with a non-string', async () => {
    const {lake, OsvVulns} = service();
    expect((await lake.cveDetails(['CVE-1999-0001'])).data.cves).toEqual([]);
    OsvVulns.calls.length = 0;
    expect((await lake.cveDetails([{$gt: ''}, 42])).data).toEqual({cves: [], matches: 0});
    expect((await lake.cveDetails(undefined)).data).toEqual({cves: [], matches: 0});
    expect(OsvVulns.calls).toHaveLength(0);
  });

  function askedIn(call) {
    return call.selector.$or[0]._id.$in;
  }

  it('looks many ids up in groups of at most 500', async () => {
    const {lake, OsvVulns} = service();
    const ids = Array.from({length: 1200}, function (_, i) { return 'CVE-2020-' + (10000 + i); });
    await lake.cveDetails(ids);
    expect(OsvVulns.calls.map(function (call) { return askedIn(call).length; })).toEqual([500, 500, 200]);
    expect(OsvVulns.calls.every(function (call) { return call.selector.$or[1].aliases.$in === askedIn(call); })).toBe(true);
    expect([].concat.apply([], OsvVulns.calls.map(askedIn))).toEqual(ids);
  });

  it('answers each id once however often it was asked, in the asked order', async () => {
    const {lake} = service();
    const unknown = Array.from({length: 600}, function () { return 'CVE-1999-0001'; });
    const response = await lake.cveDetails(unknown.concat(['CVE-2021-23337', 'CVE-2021-23337', 'GHSA-35jh-r3h4-6jhm']));
    expect(response.data.cves.map(function (c) { return c.cve_id; })).toEqual(['CVE-2021-23337', 'GHSA-35jh-r3h4-6jhm']);
    expect(response.data.matches).toBe(2);
  });

  it('looks up at most the first 5000 distinct ids', async () => {
    const {lake, OsvVulns} = service();
    const ids = Array.from({length: 6000}, function (_, i) { return 'CVE-2020-' + (10000 + i); });
    await lake.cveDetails(ids);
    expect(OsvVulns.calls).toHaveLength(10);
    expect([].concat.apply([], OsvVulns.calls.map(askedIn))).toEqual(ids.slice(0, 5000));
  });
});

describe('findByPurl', () => {
  it('lists the vulnerability ids cached for that version', async () => {
    const {lake} = service();
    expect((await lake.findByPurl('pkg:npm/lodash@4.17.20')).data)
      .toEqual({vulns: [{vulns: ['CVE-2020-28500', 'CVE-2021-23337']}]});
  });

  it('asks for the pair under one id when the purl is lower-case', async () => {
    const {lake, Cves} = service();
    await lake.findByPurl('pkg:npm/lodash@4.17.20');
    expect(Cves.calls[0].selector).toEqual({_id: {$in: [LODASH_ID]}});
  });

  describe('a purl with upper-case letters', () => {
    const PURL = 'pkg:nuget/Newtonsoft.Json@13.0.1';
    const AS_WRITTEN = pairId('nuget:Newtonsoft.Json', '13.0.1');
    const LOWER = pairId('nuget:newtonsoft.json', '13.0.1');

    function nugetService(id) {
      const Cves = fakeCollection([{_id: id, key: 'x', source: 'osv',
        versions: [{version: '13.0.1', cves: [{vuln_ids: ['CVE-2024-21907'], aliases: [], impact: {}}]}]}]);
      return {Cves, lake: createLakeService({Cves, OsvVulns: fakeCollection([]), lookupCwe})};
    }

    it('finds a pair the analysis stored under the key as written', async () => {
      const {lake, Cves} = nugetService(AS_WRITTEN);
      expect((await lake.findByPurl(PURL)).data).toEqual({vulns: [{vulns: ['CVE-2024-21907']}]});
      expect(Cves.calls[0].selector).toEqual({_id: {$in: [AS_WRITTEN, LOWER]}});
    });

    it('finds a pair the analysis stored under the lower-cased key', async () => {
      const {lake} = nugetService(LOWER);
      expect((await lake.findByPurl(PURL)).data).toEqual({vulns: [{vulns: ['CVE-2024-21907']}]});
    });
  });

  it('answers an empty list for a version no analysis checked, or a bad purl', async () => {
    const {lake, Cves} = service();
    expect((await lake.findByPurl('pkg:npm/lodash@1.0.0')).data).toEqual({vulns: []});
    Cves.calls.length = 0;
    expect((await lake.findByPurl('not a purl')).data).toEqual({vulns: []});
    expect(Cves.calls).toHaveLength(0);
  });
});

describe('search', () => {
  it('lists cached component versions whose key contains the text', async () => {
    const {lake, Cves} = service();
    const response = await lake.search('  LODASH ');
    expect(Cves.calls[0].selector).toEqual({key: {$regex: 'lodash'}});
    expect(response.data.matches).toBe(2);
    expect(response.data.list[0]).toEqual({
      _id: LODASH_ID + ':4.17.20',
      key: 'npm:lodash',
      version: '4.17.20',
      checkedAt: '2026-09-18T10:00:00.000Z',
      vulns: [{id: 'CVE-2020-28500', score: null, severity: 'moderate'}, {id: 'CVE-2021-23337', score: 7.2, severity: null}],
      score: 7.2
    });
    expect(response.data.list[1].vulns).toEqual([]);
  });

  it('escapes regex characters and ignores too short, too long or non-string text', async () => {
    const {lake, Cves} = service();
    await lake.search('lodash.merge');
    expect(Cves.calls[0].selector).toEqual({key: {$regex: 'lodash\\.merge'}});
    Cves.calls.length = 0;
    for (const query of ['a', 'x'.repeat(101), {$gt: ''}, undefined]) {
      expect((await lake.search(query)).data).toEqual({matches: 0, list: []});
    }
    expect(Cves.calls).toHaveLength(0);
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
  });

  it('reads legacy documents with several versions and vulns lists too', () => {
    const rows = searchRows([{_id: 'x', key: 'npm:a', versions: [
      {version: '1', vulns: [{cve_id: 'CVE-1', impact: {cvss2: {baseScore: 5}}}]},
      {version: '2', cves: []}
    ]}]);
    expect(rows.map(function (row) { return [row.version, row.score]; })).toEqual([['1', 5], ['2', null]]);
  });
});

describe('cweDetails', () => {
  it('answers from the bundled catalog', () => {
    const {lake} = service();
    expect(lake.cweDetails('CWE-79').data[1].cwe_id).toBe('79');
  });
});

describe('source lock - the Meteor methods read the local cache only', () => {
  const source = fs.readFileSync(path.join(REPO, 'imports/startup/server/ts-vulnerability.js'), 'utf8');

  it('guards every method and talks to no remote service', () => {
    ['tsVulnerabilityCveDetails', 'tsVulnerabilityCveFindByKey', 'tsVulnerabilityCweDetails', 'vulnerabilityLakeSearch']
      .forEach(function (name) {
        const start = source.indexOf(name + ': async function');
        expect(start).toBeGreaterThan(-1);
        expect(source.slice(start, source.indexOf('\n  }', start))).toMatch(/await require(CompanyMember|Login)\(this/);
      });
    expect(source).not.toMatch(/httpCall|Config\.|TS_VULNERABILITY|tsVulnerabilityCveFind:/);
  });

  it('has no Typesense search module any more', () => {
    expect(fs.existsSync(path.join(REPO, 'imports/startup/server/ts-vulnerability-search.js'))).toBe(false);
    expect(fs.readFileSync(path.join(REPO, 'imports/startup/server/index.js'), 'utf8'))
      .not.toContain('ts-vulnerability-search');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreVector, severityImpact, toStoredRecord, entriesForPair } from '../../../analysis/services/osv/records.js';

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
const V2 = 'AV:N/AC:L/Au:N/C:P/I:P/A:P';

function stored(id, { aliases = [], impact = {}, label = null, withdrawn = null } = {}) {
  return { _id: id, aliases, impact, severityLabel: label, withdrawn, listedModified: 'm' };
}

describe('osv records', () => {
  describe('scoreVector', () => {
    it('scores CVSS 3.x, 4.0 and 2 vectors with the calculator for their version', () => {
      assert.deepEqual(scoreVector(V31), ['cvss3',
        { vectorString: V31, version: '3.1', baseScore: 7.2, impactScore: 5.9, exploitScore: 1.2 }]);
      assert.deepEqual(scoreVector(V40), ['cvss4', { vectorString: V40, version: '4.0', baseScore: 9.3 }]);
      assert.deepEqual(scoreVector(V2), ['cvss2',
        { vectorString: V2, version: '2.0', baseScore: 7.5, impactScore: 6.4, exploitScore: 10 }]);
    });

    it('keeps a vector the calculator rejects, without a score', () => {
      assert.deepEqual(scoreVector('CVSS:3.1/AV:Q/AC:L'), ['cvss3', { vectorString: 'CVSS:3.1/AV:Q/AC:L', version: '3.1' }]);
      assert.deepEqual(scoreVector('garbage'), ['cvss2', { vectorString: 'garbage', version: '2.0' }]);
    });

    it('answers null for no vector and for an unknown CVSS version', () => {
      assert.equal(scoreVector(''), null);
      assert.equal(scoreVector(undefined), null);
      assert.equal(scoreVector('CVSS:5.0/AV:N'), null);
    });
  });

  describe('severityImpact', () => {
    it('keeps the first CVSS vector per version and ignores other severity types', () => {
      const impact = severityImpact([
        { type: 'Ubuntu', score: 'medium' },
        { type: 'CVSS_V3', score: V31 },
        { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
        { type: 'CVSS_V4', score: V40 }
      ]);
      assert.deepEqual(Object.keys(impact).sort(), ['cvss3', 'cvss4']);
      assert.equal(impact.cvss3.baseScore, 7.2);
      assert.equal(impact.cvss4.baseScore, 9.3);
      assert.deepEqual(severityImpact(undefined), {});
    });
  });

  describe('toStoredRecord', () => {
    it('keeps what the UI, reports and VEX use, with the listed modified value', () => {
      const now = new Date('2026-09-18T10:00:00Z');
      const osv = {
        id: 'GHSA-35jh-r3h4-6jhm',
        summary: 'Command Injection in lodash',
        details: 'lodash versions prior to 4.17.21 are vulnerable to Command Injection.',
        aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc', 42],
        modified: '2026-09-10T03:49:04.067984836Z',
        published: '2021-05-06T16:05:51Z',
        database_specific: { severity: 'HIGH', github_reviewed: true, cwe_ids: ['CWE-77', 'CWE-94'] },
        severity: [{ type: 'CVSS_V3', score: V31 }],
        references: [{ type: 'ADVISORY', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337' }, { type: 'WEB' }],
        affected: [{
          package: { name: 'lodash', ecosystem: 'npm', purl: 'pkg:npm/lodash' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
          database_specific: { source: 'ignored' }
        }]
      };

      assert.deepEqual(toStoredRecord(osv, '2026-09-10T03:49:04.067984Z', now), {
        _id: 'GHSA-35jh-r3h4-6jhm',
        aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
        summary: 'Command Injection in lodash',
        details: 'lodash versions prior to 4.17.21 are vulnerable to Command Injection.',
        published: '2021-05-06T16:05:51Z',
        modified: '2026-09-10T03:49:04.067984836Z',
        listedModified: '2026-09-10T03:49:04.067984Z',
        withdrawn: null,
        cwe_ids: ['CWE-77', 'CWE-94'],
        severityLabel: 'HIGH',
        severity: [{ type: 'CVSS_V3', score: V31 }],
        impact: { cvss3: { vectorString: V31, version: '3.1', baseScore: 7.2, impactScore: 5.9, exploitScore: 1.2 } },
        references: [{ type: 'ADVISORY', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337' }],
        affected: [{
          ecosystem: 'npm', name: 'lodash', purl: 'pkg:npm/lodash',
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }]
        }],
        fetchedAt: now
      });
    });

    it('keeps only http and https references, which the lake renders as links', () => {
      const record = toStoredRecord({
        id: 'GHSA-35jh-r3h4-6jhm',
        references: [
          { type: 'WEB', url: 'javascript:alert(1)' },
          { type: 'WEB', url: 'data:text/html,<b>x</b>' },
          { type: 'ADVISORY', url: 'HTTPS://example.org/advisory' },
          { type: 'WEB', url: 'http://example.org/page' }
        ]
      }, 'm', new Date());
      assert.deepEqual(record.references, [
        { type: 'ADVISORY', url: 'HTTPS://example.org/advisory' },
        { type: 'WEB', url: 'http://example.org/page' }
      ]);
    });

    it('stores a missing listed modified value as null and caps long lists', () => {
      const record = toStoredRecord({
        id: 'PYSEC-2021-1',
        details: 'x'.repeat(30000),
        affected: Array.from({ length: 80 }, (_, i) => ({ package: { ecosystem: 'PyPI', name: 'p' + i } }))
      }, undefined, new Date());
      assert.equal(record.listedModified, null);
      assert.equal(record.details.length, 20000);
      assert.equal(record.affected.length, 50);
      assert.deepEqual(record.impact, {});
      assert.equal(record.severityLabel, null);
    });
  });

  describe('entriesForPair', () => {
    it('collapses records linked through aliases into one entry named after its CVE', () => {
      const entries = entriesForPair([
        stored('GHSA-35jh-r3h4-6jhm', {
          aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
          impact: { cvss3: { baseScore: 7.2, vectorString: V31, version: '3.1' } },
          label: 'HIGH'
        }),
        stored('GHSA-r5fr-rjxr-66jc', {
          aliases: ['CVE-2026-4800'],
          impact: { cvss4: { baseScore: 9.3, vectorString: V40, version: '4.0' } }
        }),
        stored('GHSA-29mw-wpgm-hmr9', { aliases: ['CVE-2020-28500'], label: 'MODERATE' })
      ]);

      assert.deepEqual(entries, [
        {
          vuln_ids: ['CVE-2020-28500'],
          aliases: ['GHSA-29mw-wpgm-hmr9'],
          osv_ids: ['GHSA-29mw-wpgm-hmr9'],
          impact: {},
          cisa: null,
          severity: 'moderate'
        },
        {
          vuln_ids: ['CVE-2021-23337'],
          aliases: ['CVE-2026-4800', 'GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'],
          osv_ids: ['GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc'],
          impact: { cvss4: { baseScore: 9.3, vectorString: V40, version: '4.0' } },
          cisa: null,
          severity: 'high'
        }
      ]);
    });

    it('names a record without a CVE after its own id and drops withdrawn records', () => {
      assert.deepEqual(entriesForPair([
        stored('RUSTSEC-2021-0001'),
        stored('GHSA-gone-gone-gone', { aliases: ['CVE-2000-0001'], withdrawn: '2024-01-01T00:00:00Z' })
      ]), [{ vuln_ids: ['RUSTSEC-2021-0001'], aliases: [], osv_ids: ['RUSTSEC-2021-0001'], impact: {}, cisa: null }]);
    });

    it('takes the highest CVSS version that carries a score', () => {
      const [entry] = entriesForPair([
        stored('GHSA-aaaa-aaaa-aaaa', {
          aliases: ['CVE-2021-0001'],
          impact: { cvss4: { vectorString: 'CVSS:4.0/AV:Q', version: '4.0' } }
        }),
        stored('GHSA-bbbb-bbbb-bbbb', {
          aliases: ['CVE-2021-0001'],
          impact: { cvss3: { baseScore: 7.2, vectorString: V31, version: '3.1' } }
        })
      ]);
      assert.deepEqual(entry.impact, { cvss3: { baseScore: 7.2, vectorString: V31, version: '3.1' } });
    });

    it('falls back to the highest version with a vector when no version carries a score', () => {
      const [entry] = entriesForPair([
        stored('GHSA-aaaa-aaaa-aaaa', { impact: { cvss4: { vectorString: 'CVSS:4.0/AV:Q', version: '4.0' } } }),
        stored('GHSA-bbbb-bbbb-bbbb', {
          aliases: ['GHSA-aaaa-aaaa-aaaa'],
          impact: { cvss3: { vectorString: 'CVSS:3.1/AV:Q/AC:L', version: '3.1' } }
        })
      ]);
      assert.deepEqual(entry.impact, { cvss4: { vectorString: 'CVSS:4.0/AV:Q', version: '4.0' } });
    });

    it('answers an empty list for no records', () => {
      assert.deepEqual(entriesForPair([]), []);
    });
  });
});

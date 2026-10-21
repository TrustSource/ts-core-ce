// OSV cache records -> the `cve` detail shape every CVE panel, report, the VEX export and
// the Vuln by ID page read.
const {canonicalVulnId, lookupIds} = require('../../imports/lib/osv/vulnId');
const {osvToCve, mergeCveDetails} = require('../../imports/lib/osv/osvToCve');

const V31 = 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H';
const V40 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

const GHSA_35JH = {
  _id: 'GHSA-35jh-r3h4-6jhm',
  aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
  summary: 'Command Injection in lodash',
  details: 'lodash versions prior to 4.17.21 are vulnerable to Command Injection via the template function.',
  published: '2021-05-06T16:05:51Z',
  modified: '2026-09-10T03:49:04.067984836Z',
  withdrawn: null,
  cwe_ids: ['CWE-77', 'CWE-94'],
  severityLabel: 'HIGH',
  impact: {cvss3: {vectorString: V31, version: '3.1', baseScore: 7.2, impactScore: 5.9, exploitScore: 1.2}},
  references: [{type: 'ADVISORY', url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337'}],
  affected: [{ecosystem: 'npm', name: 'lodash', purl: 'pkg:npm/lodash',
    ranges: [{type: 'SEMVER', events: [{introduced: '0'}, {fixed: '4.17.21'}]}]}]
};

describe('canonicalVulnId / lookupIds', () => {
  it('upper-cases ids but keeps a GHSA body lower case', () => {
    expect(canonicalVulnId(' cve-2021-44228 ')).toBe('CVE-2021-44228');
    expect(canonicalVulnId('ghsa-35JH-R3H4-6jhm')).toBe('GHSA-35jh-r3h4-6jhm');
    expect(canonicalVulnId('PYSEC-2021-19')).toBe('PYSEC-2021-19');
  });

  it('refuses anything that is not an id', () => {
    expect(canonicalVulnId({$gt: ''})).toBe('');
    expect(canonicalVulnId('a b')).toBe('');
    expect(canonicalVulnId('x'.repeat(101))).toBe('');
    expect(lookupIds(undefined)).toEqual([]);
  });

  it('tries an id as typed and in its canonical spelling', () => {
    expect(lookupIds('BIT-apache-2021-41773')).toEqual(['BIT-apache-2021-41773', 'BIT-APACHE-2021-41773']);
    expect(lookupIds('CVE-2021-44228')).toEqual(['CVE-2021-44228']);
  });
});

describe('osvToCve', () => {
  it('maps a stored record to the legacy detail shape', () => {
    expect(osvToCve(GHSA_35JH)).toEqual({
      cve_id: 'GHSA-35jh-r3h4-6jhm',
      osv_id: 'GHSA-35jh-r3h4-6jhm',
      aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
      published: '2021-05-06T16:05:51Z',
      lastmodified: '2026-09-10T03:49:04.067984836Z',
      description: 'lodash versions prior to 4.17.21 are vulnerable to Command Injection via the template function.',
      summary: 'Command Injection in lodash',
      weakness: 'CWE-77',
      cwe_ids: ['CWE-77', 'CWE-94'],
      severityLabel: 'HIGH',
      affected: [{ecosystem: 'npm', name: 'lodash', ranges: ['>= 0, < 4.17.21']}],
      impact: {
        cvss3: {vectorString: V31, baseScore: 7.2, version: '3.1'},
        cvss3_exploitscore: 1.2,
        cvss3_impactscore: 5.9
      },
      references: [{url: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337',
        name: 'https://nvd.nist.gov/vuln/detail/CVE-2021-23337', refsource: 'ADVISORY', tags: []}],
      cisa: null
    });
  });

  it('lists only http and https references, which the details render as links', () => {
    const record = Object.assign({}, GHSA_35JH, {references: [
      {type: 'WEB', url: 'javascript:alert(1)'},
      {type: 'ADVISORY', url: 'HTTPS://example.org/advisory'},
      {type: 'WEB', url: 'data:text/html,<b>x</b>'},
      {type: 'WEB'}
    ]});
    expect(osvToCve(record).references).toEqual([
      {url: 'HTTPS://example.org/advisory', name: 'HTTPS://example.org/advisory', refsource: 'ADVISORY', tags: []}
    ]);
  });
});

describe('mergeCveDetails', () => {
  it('names the entry after the id asked for and lists every other id as an alias', () => {
    const detail = mergeCveDetails('CVE-2021-23337', [GHSA_35JH]);
    expect(detail.cve_id).toBe('CVE-2021-23337');
    expect(detail.osv_id).toBe('GHSA-35jh-r3h4-6jhm');
    expect(detail.aliases).toEqual(['CVE-2026-4800', 'GHSA-35jh-r3h4-6jhm', 'GHSA-r5fr-rjxr-66jc']);
  });

  it('starts from the best-scored record and fills gaps from the others', () => {
    const other = {_id: 'GHSA-r5fr-rjxr-66jc', aliases: ['CVE-2026-4800'], details: '', summary: '',
      cwe_ids: [], impact: {cvss4: {vectorString: V40, version: '4.0', baseScore: 9.3}}, references: [], affected: []};
    const detail = mergeCveDetails('CVE-2026-4800', [GHSA_35JH, other]);
    expect(detail.osv_id).toBe('GHSA-r5fr-rjxr-66jc');
    expect(detail.impact.cvss4.baseScore).toBe(9.3);
    expect(detail.impact.cvss3.baseScore).toBe(7.2);
    expect(detail.weakness).toBe('CWE-77');
    expect(detail.description).toBe(GHSA_35JH.details);
  });

  it('prefers live records, still answers for a withdrawn one asked by name, and null for none', () => {
    const withdrawn = Object.assign({}, GHSA_35JH, {withdrawn: '2026-01-01T00:00:00Z'});
    expect(mergeCveDetails('GHSA-35jh-r3h4-6jhm', [withdrawn]).cve_id).toBe('GHSA-35jh-r3h4-6jhm');
    expect(mergeCveDetails('CVE-1', [])).toBeNull();
  });
});

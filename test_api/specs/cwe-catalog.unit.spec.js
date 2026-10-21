// The CWE catalog is bundled (tools/cwe/build-cwe-catalog.mjs); the Find CWE page, the
// CSAF editor and the VEX export read it through tsVulnerabilityCweDetails.
const {parseCsv, toCatalog} = require('../../tools/cwe/cweCsv');
const {lookupCwe, cweNumber} = require('../../imports/server/cwe/cweCatalog');
const {toCweDetails} = require('../../imports/client/ui/vulnerability-lake/vulnerabilityLakeCweHelpers');

const HEADER = 'CWE-ID,Name,Weakness Abstraction,Status,Description,Extended Description,Common Consequences,' +
  'Detection Methods,Potential Mitigations';

describe('parseCsv', () => {
  it('reads quoted fields with commas, line breaks and doubled quotes', () => {
    expect(parseCsv('a,"b, c","line1\nline2","say ""hi"""\r\n1,2,3,4\n')).toEqual([
      ['a', 'b, c', 'line1\nline2', 'say "hi"'],
      ['1', '2', '3', '4']
    ]);
  });
});

describe('toCatalog', () => {
  it('keeps the page fields and drops MITRE\'s closing list separator', () => {
    const rows = parseCsv(HEADER + '\n' +
      '79,"XSS",Base,Stable,"Bad output.","",' +
      '"::SCOPE:Integrity:IMPACT:Execute Code::",,"::PHASE:Implementation:DESCRIPTION:Encode output.::"\n');
    expect(toCatalog(rows)).toEqual({
      79: {
        cwe_id: '79',
        name: 'XSS',
        description: 'Bad output.',
        consequences: '::SCOPE:Integrity:IMPACT:Execute Code',
        mitigations: '::PHASE:Implementation:DESCRIPTION:Encode output.'
      }
    });
  });

  it('refuses a CSV without an expected column', () => {
    expect(() => toCatalog(parseCsv('CWE-ID,Name\n1,x\n'))).toThrow(/Description/);
  });
});

describe('cweNumber', () => {
  it('accepts the forms the search box advertises', () => {
    expect(cweNumber('79')).toBe('79');
    expect(cweNumber('CWE-79')).toBe('79');
    expect(cweNumber('cwe 79')).toBe('79');
    expect(cweNumber('CWE:079')).toBe('79');
    expect(cweNumber('915 *')).toBe('915');
    expect(cweNumber(79)).toBe('79');
  });

  it('refuses anything else', () => {
    expect(cweNumber('NVD-CWE-Other')).toBe('');
    expect(cweNumber('79-CWE')).toBe('');
    expect(cweNumber({$gt: ''})).toBe('');
    expect(cweNumber(undefined)).toBe('');
  });

  it('rejects oversized input (DoS protection) and accepts CWE-915 *', () => {
    expect(cweNumber('cwe' + ' '.repeat(10000) + 'x')).toBe('');
    expect(cweNumber('CWE-915 *')).toBe('915');
  });
});

describe('lookupCwe', () => {
  it('answers a catalog entry in the shape the Find CWE page reads', () => {
    const response = lookupCwe('CWE-79');
    expect(response.statusCode).toBe(200);
    expect(response.data.matches).toBe(1);
    expect(response.data[1].cwe_id).toBe('79');
    expect(response.data[1].name).toMatch(/Cross-site Scripting/);
    expect(toCweDetails(response).details.cwe_id).toBe('79');
  });

  it('answers no match for an unknown or unusable id', () => {
    expect(lookupCwe('999999')).toEqual({statusCode: 200, data: {matches: 0}});
    expect(lookupCwe('__proto__')).toEqual({statusCode: 200, data: {matches: 0}});
    expect(toCweDetails(lookupCwe('999999'))).toEqual({matches: 0, details: {}});
  });
});

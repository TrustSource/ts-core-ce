/* eslint-disable no-undef */
const enums = require('../../imports/lib/cyclonedx/enums');

describe('cyclonedx/enums', () => {
  it('exposes the 1.7 spec version and import-supported versions', () => {
    expect(enums.SPEC_VERSION).toBe('1.7');
    expect(enums.SUPPORTED_IMPORT_VERSIONS).toEqual(
      ['1.2', '1.3', '1.4', '1.5', '1.6', '1.7']
    );
  });

  it('lists the four crypto asset types', () => {
    expect(enums.ASSET_TYPES).toEqual(
      ['algorithm', 'certificate', 'protocol', 'related-crypto-material']
    );
  });

  it('uses real cipher modes (not CPU platforms)', () => {
    expect(enums.MODE).toEqual(
      ['cbc', 'ecb', 'ccm', 'gcm', 'cfb', 'ofb', 'ctr', 'other', 'unknown']
    );
    expect(enums.MODE).not.toContain('x86_64');
  });

  it('includes 1.7 protocol types and the key-wrap primitive', () => {
    expect(enums.PROTOCOL_TYPE).toEqual(expect.arrayContaining(
      ['dtls', 'quic', 'eap-aka', 'eap-aka-prime', 'prins', '5g-aka']
    ));
    expect(enums.PRIMITIVE).toContain('key-wrap');
  });

  it('certification levels and crypto functions are non-empty arrays', () => {
    expect(Array.isArray(enums.CERTIFICATION_LEVEL)).toBe(true);
    expect(enums.CRYPTO_FUNCTIONS).toContain('encapsulate');
  });
});

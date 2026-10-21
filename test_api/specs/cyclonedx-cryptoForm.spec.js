/* eslint-disable no-undef */
const {buildCryptoPayload} = require('../../imports/lib/cyclonedx/cryptoForm');

describe('cyclonedx/cryptoForm.buildCryptoPayload', () => {
  it('builds an algorithm payload from flat form values', () => {
    const payload = buildCryptoPayload('algorithm', {
      primitive: 'block-cipher', mode: 'gcm', padding: 'pkcs7',
      cryptoFunctions: ['encrypt', 'decrypt'], certificationLevel: ['fips140-3-l1'],
      classicalSecurityLevel: '128', nistQuantumSecurityLevel: '1',
      curve: '', parameterSetIdentifier: '',
      executionEnvironment: 'hardware', implementationPlatform: 'x86_64',
      // foreign keys must be ignored:
      subjectName: 'should-not-appear'
    });
    expect(payload.assetType).toBe('algorithm');
    expect(payload.algorithmProperties.primitive).toBe('block-cipher');
    expect(payload.algorithmProperties.cryptoFunctions).toEqual(['encrypt', 'decrypt']);
    expect(payload.algorithmProperties).not.toHaveProperty('subjectName');
    // empty strings dropped
    expect(payload.algorithmProperties).not.toHaveProperty('curve');
    // only the asset-type's field object is present
    expect(payload).not.toHaveProperty('certificateProperties');
  });

  it('builds a certificate payload', () => {
    const payload = buildCryptoPayload('certificate', {
      subjectName: 'CN=acme', issuerName: 'CN=ca', certificateFormat: 'X.509',
      certificateState: ['active'], serialNumber: '01', primitive: 'ignored'
    });
    expect(payload.assetType).toBe('certificate');
    expect(payload.certificateProperties.subjectName).toBe('CN=acme');
    expect(payload.certificateProperties.certificateState).toEqual(['active']);
    expect(payload.certificateProperties).not.toHaveProperty('primitive');
  });

  it('builds a protocol payload', () => {
    const payload = buildCryptoPayload('protocol', {type: 'tls', version: '1.3'});
    expect(payload.assetType).toBe('protocol');
    expect(payload.protocolProperties).toEqual({type: 'tls', version: '1.3'});
  });

  it('builds a related-crypto-material payload', () => {
    const payload = buildCryptoPayload('related-crypto-material', {
      type: 'secret-key', state: 'active', size: '256', format: 'raw'
    });
    expect(payload.assetType).toBe('related-crypto-material');
    expect(payload.relatedCryptoMaterialProperties).toEqual({
      type: 'secret-key', state: 'active', size: '256', format: 'raw'
    });
  });

  it('defaults unknown asset types to algorithm', () => {
    const payload = buildCryptoPayload('bogus', {primitive: 'hash'});
    expect(payload.assetType).toBe('algorithm');
  });
});

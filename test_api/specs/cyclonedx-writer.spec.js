/* eslint-disable no-undef */
const writer = require('../../imports/lib/cyclonedx/writer');
const {validateCycloneDX} = require('../helpers/cyclonedxValidate');

// Minimal report shaped like reportConverter input: a tree of dependencies plus a
// cryptoProperties map keyed by moduleId (and 'project').
function sampleReport() {
  return {
    company: {name: 'Acme', distribution: {email: 'sec@acme.test'}},
    cryptoProperties: {
      modA: [
        {name: 'AES', assetType: 'algorithm', algorithmProperties: {
          primitive: 'block-cipher', mode: 'gcm', padding: 'pkcs7',
          cryptoFunctions: ['encrypt', 'decrypt'], certificationLevel: ['fips140-3-l1'],
          classicalSecurityLevel: '128', nistQuantumSecurityLevel: '1',
          implementationPlatform: 'x86_64', executionEnvironment: 'hardware'
        }},
        {name: 'MyCert', assetType: 'certificate', certificateProperties: {
          subjectName: 'CN=acme', issuerName: 'CN=acme-ca', certificateFormat: 'X.509',
          certificateState: ['active'], serialNumber: '01'
        }},
        {name: 'TLS', assetType: 'protocol', protocolProperties: {
          type: 'tls', version: '1.3', cipherSuites: []
        }},
        {name: 'AESKey', assetType: 'related-crypto-material',
          relatedCryptoMaterialProperties: {
            type: 'secret-key', state: 'active', size: '256', format: 'raw'
          }}
      ]
    },
    tree: {dependencies: [
      {
        name: 'app', key: 'npm:app', version: '1.0.0',
        crypto_algorithms: [
          {algorithm: 'AES'}, {algorithm: 'MyCert'}, {algorithm: 'TLS'}, {algorithm: 'AESKey'}
        ],
        moduleId: 'modA',
        dependencies: [
          {name: 'left-pad', key: 'npm:left-pad', version: '1.3.0', dependencies: []}
        ]
      }
    ]}
  };
}

describe('cyclonedx/writer.buildDocument', () => {
  it('emits a schema-valid 1.7 SBOM with non-deprecated tools.components', () => {
    const doc = writer.buildDocument(sampleReport(), 'SBOM');
    expect(doc.specVersion).toBe('1.7');
    expect(doc.bomFormat).toBe('CycloneDX');
    expect(doc.serialNumber).toMatch(/^urn:uuid:/);
    expect(Array.isArray(doc.metadata.tools.components)).toBe(true);
    expect(doc.metadata.tools.components[0]).toHaveProperty('type', 'application');
    // SBOM variant excludes crypto assets
    expect(doc.components.some((c) => c.type === 'cryptographic-asset')).toBe(false);
    expect(doc.components.some((c) => c.name === 'app')).toBe(true);
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('emits schema-valid crypto assets of all four types in CBOM variant', () => {
    const doc = writer.buildDocument(sampleReport(), 'CBOM');
    const crypto = doc.components.filter((c) => c.type === 'cryptographic-asset');
    const byType = {};
    crypto.forEach((c) => { byType[c.cryptoProperties.assetType] = c; });
    expect(Object.keys(byType).sort()).toEqual(
      ['algorithm', 'certificate', 'protocol', 'related-crypto-material']
    );
    // integer + array coercion happened
    const algo = byType.algorithm.cryptoProperties.algorithmProperties;
    expect(algo.classicalSecurityLevel).toBe(128);
    expect(algo.nistQuantumSecurityLevel).toBe(1);
    expect(Array.isArray(algo.cryptoFunctions)).toBe(true);
    expect(byType['related-crypto-material'].cryptoProperties
      .relatedCryptoMaterialProperties.size).toBe(256);
    // empty cipherSuites array was stripped (no empty arrays emitted)
    expect(byType.protocol.cryptoProperties.protocolProperties)
      .not.toHaveProperty('cipherSuites');
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('emits cipherSuites as spec cipherSuite objects, not bare strings', () => {
    const report = sampleReport();
    // UI/form stores a bare suite name string; a single value also arrives un-arrayed.
    report.cryptoProperties.modA[2].protocolProperties.cipherSuites = 'TLS_AES_256_GCM_SHA384';
    const doc = writer.buildDocument(report, 'CBOM');
    const protocol = doc.components.find((c) => c.cryptoProperties &&
      c.cryptoProperties.assetType === 'protocol');
    const suites = protocol.cryptoProperties.protocolProperties.cipherSuites;
    expect(Array.isArray(suites)).toBe(true);
    expect(suites).toEqual([{name: 'TLS_AES_256_GCM_SHA384'}]);
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('drops invalid legacy mode values rather than emitting them', () => {
    const report = sampleReport();
    report.cryptoProperties.modA[0].algorithmProperties.mode = 'x86_64'; // legacy bad value
    const doc = writer.buildDocument(report, 'CBOM');
    const algo = doc.components.find((c) => c.cryptoProperties &&
      c.cryptoProperties.assetType === 'algorithm');
    expect(algo.cryptoProperties.algorithmProperties).not.toHaveProperty('mode');
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('emits managed crypto assets not linked to any component (no detected crypto)', () => {
    // Mirrors a module whose assets were recorded manually in settings: cryptoProperties
    // is populated but the tree has NO crypto_algorithms linking them to a component.
    const report = {
      company: {name: 'Acme'},
      cryptoProperties: {
        modA: [
          {name: 'AES-256-GCM', assetType: 'algorithm',
            algorithmProperties: {primitive: 'block-cipher', mode: 'gcm'}},
          {name: 'acme.test TLS certificate', assetType: 'certificate',
            certificateProperties: {subjectName: 'CN=acme.test', certificateFormat: 'X.509'}}
        ],
        project: [
          {name: 'TLS 1.3', assetType: 'protocol',
            protocolProperties: {type: 'tls', version: '1.3'}}
        ]
      },
      tree: {dependencies: [
        {name: 'app', key: 'npm:app', version: '1.0.0', dependencies: []}
      ]}
    };
    const doc = writer.buildDocument(report, 'CBOM');
    const names = doc.components
      .filter((c) => c.type === 'cryptographic-asset')
      .map((c) => c.name).sort();
    expect(names).toEqual(['AES-256-GCM', 'TLS 1.3', 'acme.test TLS certificate']);
    expect(validateCycloneDX(doc)).toEqual([]);
  });

  it('does not duplicate a managed asset that is also linked to a component', () => {
    const report = sampleReport(); // tree links AES/MyCert/TLS/AESKey via crypto_algorithms
    const doc = writer.buildDocument(report, 'CBOM');
    const aesCount = doc.components.filter((c) => c.name === 'AES').length;
    expect(aesCount).toBe(1);
    expect(validateCycloneDX(doc)).toEqual([]);
  });
});

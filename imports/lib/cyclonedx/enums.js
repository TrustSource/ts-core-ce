// CycloneDX 1.7 enums - single source of truth shared by the writer, the reader
// (Plan 3), and the module-settings UI (Plan 2). CommonJS so jest can require it.

const SPEC_VERSION = '1.7';
const SUPPORTED_IMPORT_VERSIONS = ['1.2', '1.3', '1.4', '1.5', '1.6', '1.7'];

const ASSET_TYPES = ['algorithm', 'certificate', 'protocol', 'related-crypto-material'];

// machine-learning-model components are round-tripped separately (into aiProperties),
// mirroring how cryptographic-asset feeds cryptoProperties. ML_MODEL_PROP_KEYS is the
// structured-field allowlist kept on a managed AI artifact (the rest of the CycloneDX
// modelCard is preserved verbatim as a raw passthrough alongside these).
const ML_ASSET_TYPE = 'machine-learning-model';
const ML_MODEL_PROP_KEYS = ['provider', 'task', 'modelFamily', 'architecture', 'version', 'purl'];

// Full CycloneDX 1.7 component.type enum. `cryptographic-asset` is round-tripped
// separately (into cryptoProperties); every other type maps to a real dependency.
const COMPONENT_TYPES = ['application', 'framework', 'library', 'container',
  'platform', 'operating-system', 'device', 'device-driver', 'firmware', 'file',
  'machine-learning-model', 'data', 'cryptographic-asset'];

const PRIMITIVE = ['drbg', 'mac', 'block-cipher', 'stream-cipher', 'signature',
  'hash', 'pke', 'xof', 'kdf', 'key-agree', 'kem', 'ae', 'combiner', 'key-wrap',
  'other', 'unknown'];

const EXECUTION_ENVIRONMENT = ['software-plain-ram', 'software-encrypted-ram',
  'software-tee', 'hardware', 'other', 'unknown'];

const IMPLEMENTATION_PLATFORM = ['generic', 'x86_32', 'x86_64', 'armv7-a',
  'armv7-m', 'armv8-a', 'armv8-m', 'armv9-a', 'armv9-m', 's390x', 'ppc64',
  'ppc64le', 'other', 'unknown'];

const MODE = ['cbc', 'ecb', 'ccm', 'gcm', 'cfb', 'ofb', 'ctr', 'other', 'unknown'];

const PADDING = ['pkcs5', 'pkcs7', 'pkcs1v15', 'oaep', 'raw', 'other', 'unknown'];

const CRYPTO_FUNCTIONS = ['generate', 'keygen', 'encrypt', 'decrypt', 'digest',
  'tag', 'keyderive', 'sign', 'verify', 'encapsulate', 'decapsulate', 'other',
  'unknown'];

const CERTIFICATION_LEVEL = ['none', 'fips140-1-l1', 'fips140-1-l2', 'fips140-1-l3',
  'fips140-1-l4', 'fips140-2-l1', 'fips140-2-l2', 'fips140-2-l3', 'fips140-2-l4',
  'fips140-3-l1', 'fips140-3-l2', 'fips140-3-l3', 'fips140-3-l4', 'cc-eal1',
  'cc-eal1+', 'cc-eal2', 'cc-eal2+', 'cc-eal3', 'cc-eal3+', 'cc-eal4', 'cc-eal4+',
  'cc-eal5', 'cc-eal5+', 'cc-eal6', 'cc-eal6+', 'cc-eal7', 'cc-eal7+', 'other',
  'unknown'];

const CERTIFICATE_STATE = ['pre-activation', 'active', 'suspended', 'deactivated',
  'revoked', 'destroyed'];

const PROTOCOL_TYPE = ['tls', 'ssh', 'ipsec', 'ike', 'sstp', 'wpa', 'dtls', 'quic',
  'eap-aka', 'eap-aka-prime', 'prins', '5g-aka', 'other', 'unknown'];

const RELATED_MATERIAL_TYPE = ['private-key', 'public-key', 'secret-key', 'key',
  'ciphertext', 'signature', 'digest', 'initialization-vector', 'nonce', 'seed',
  'salt', 'shared-secret', 'tag', 'additional-data', 'password', 'credential',
  'token', 'other', 'unknown'];

const RELATED_MATERIAL_STATE = ['pre-activation', 'active', 'suspended',
  'deactivated', 'compromised', 'destroyed'];

// Property keys per crypto asset type - the writer passes through only these keys
// (after cleaning) so unknown UI fields never reach the document.
const ALGORITHM_PROP_KEYS = ['primitive', 'parameterSetIdentifier', 'curve',
  'executionEnvironment', 'implementationPlatform', 'certificationLevel', 'mode',
  'padding', 'cryptoFunctions', 'classicalSecurityLevel', 'nistQuantumSecurityLevel'];
const CERTIFICATE_PROP_KEYS = ['subjectName', 'issuerName', 'notValidBefore',
  'notValidAfter', 'certificateFormat', 'certificateFileExtension', 'serialNumber',
  'certificateState', 'creationDate', 'activationDate', 'deactivationDate',
  'revocationDate', 'destructionDate'];
const PROTOCOL_PROP_KEYS = ['type', 'version', 'cipherSuites'];
const RELATED_MATERIAL_PROP_KEYS = ['type', 'id', 'state', 'creationDate',
  'activationDate', 'updateDate', 'expirationDate', 'value', 'size', 'format'];

// Fields requiring numeric coercion before emit (UI stores strings).
const INTEGER_PROP_KEYS = ['classicalSecurityLevel', 'nistQuantumSecurityLevel', 'size'];
// Fields that must be arrays.
const ARRAY_PROP_KEYS = ['certificationLevel', 'cryptoFunctions', 'certificateState',
  'cipherSuites'];

module.exports = {
  SPEC_VERSION,
  SUPPORTED_IMPORT_VERSIONS,
  ASSET_TYPES,
  ML_ASSET_TYPE,
  ML_MODEL_PROP_KEYS,
  COMPONENT_TYPES,
  PRIMITIVE,
  EXECUTION_ENVIRONMENT,
  IMPLEMENTATION_PLATFORM,
  MODE,
  PADDING,
  CRYPTO_FUNCTIONS,
  CERTIFICATION_LEVEL,
  CERTIFICATE_STATE,
  PROTOCOL_TYPE,
  RELATED_MATERIAL_TYPE,
  RELATED_MATERIAL_STATE,
  ALGORITHM_PROP_KEYS,
  CERTIFICATE_PROP_KEYS,
  PROTOCOL_PROP_KEYS,
  RELATED_MATERIAL_PROP_KEYS,
  INTEGER_PROP_KEYS,
  ARRAY_PROP_KEYS
};

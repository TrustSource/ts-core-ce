// ---------------------------------------------------------------------------
// The CSAF product_id binding, running against the REAL imports/lib/crypto.js.
//
// Why this file exists
// --------------------
// test_api/specs/csaf-product-id.unit.spec.js proves the codec's BEHAVIOUR, but
// it builds the codec with an AES-256-GCM pair defined inside that spec, because
// imports/lib/crypto.js opens with `Npm.require('crypto')` and cannot be required
// under Jest. That leaves exactly one property unproven there: that
// imports/server/csaf/productId.js really wires crypto.js's encrypt/decrypt/
// VERSION_PREFIX into the codec, rather than something that merely looks right.
//
// imports/server/csaf/productId.spec.js was written to cover it under
// `yarn meteor-test`, but that runner does not boot: the bundled server dies with
// `SyntaxError: Identifier '__dirname' has already been declared` from
// meteortesting:mocha's puppeteer/yargs dependency. Reproduced at baseline
// 15d9ad4f1, so it is pre-existing - but the consequence is that productId.spec.js
// has never executed a single assertion.
//
// How this file closes that
// -------------------------
// tools/security/crypto-selftest.cjs already loads the real crypto.js under plain
// Node by transforming it to runnable CommonJS (Npm.require -> require, drop the
// ESM export keyword). The same transform is applied here to BOTH crypto.js and
// productId.js, so what runs below is the shipped source of the binding, wired to
// the shipped source of the cipher and the shipped source of the codec.
//
// The transform is anchored: every substitution asserts it actually matched, so a
// renamed import or a reshaped export makes this spec throw loudly rather than
// quietly fall back to something that is not the production file.
//
// The central assertions do not trust the transform either. A token minted by the
// binding is decrypted here with a hand-rolled AES-256-GCM decipher keyed on
// sha256(TS_ENCRYPTION_KEY): if that plaintext comes back, the token genuinely is
// crypto.js's at-rest scheme under the environment key, whatever the transform did.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '../..');
const CRYPTO_JS = 'imports/lib/crypto.js';
const PRODUCT_ID_JS = 'imports/server/csaf/productId.js';
const CODEC_JS = 'imports/server/csaf/productIdCodec.js';

// crypto.js's own constants, mirrored here ONLY for the independent verification
// below (they are what the hand-rolled decipher needs to know). They are never
// used to build a token - every token in this file comes out of the shipped code.
const IV_LEN = 12;
const TAG_LEN = 16;
const TEST_KEY = 'csaf-product-id-real-crypto-spec-key';

// TS_ENCRYPTION_KEY also protects stored integration credentials, REST API keys
// and PSIRT keys, so the CSAF binding does NOT encrypt under it directly: it
// derives a domain subkey, sha256(`${secret}|${domain}`), the same construction
// crypto.js's blind-index key already uses. Both values are spelled out here
// rather than imported, so the verification below rebuilds the key independently
// instead of agreeing with whatever the shipped code happens to hold.
const CSAF_KEY_DOMAIN = 'csaf-product-id-v1';
const CSAF_SECRET = `${TEST_KEY}|${CSAF_KEY_DOMAIN}`;
const HMAC_SECRET = `${TEST_KEY}|hmac-v1`;

const tempFiles = [];

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// Write a transformed module to a UNIQUE path under the OS temp dir. Unique so
// Node's module cache can never hand back a stale copy from an earlier run, and
// outside the repo so a crashed run cannot leave a stray file in the tree.
let materialized = 0;
function materialize(label, source) {
  materialized += 1;
  const file = path.join(os.tmpdir(), `csaf-real-crypto-${process.pid}-${materialized}-${label}.cjs`);
  fs.writeFileSync(file, source);
  tempFiles.push(file);
  return file;
}

/**
 * Apply a substitution and refuse to continue if it changed nothing.
 *
 * This is what stops the spec degrading into a test of its own fake: if someone
 * renames the crypto import in productId.js, the replacement silently no-ops, the
 * module would then be missing `encrypt`, and the failures would be confusing
 * rather than pointing at the real cause. Failing at transform time names it.
 */
function substitute(source, pattern, replacement, what) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(
      `csaf-product-id-real-crypto: could not ${what}. The shipped source changed shape; ` +
      're-anchor this transform against it - never weaken or delete this spec.');
  }
  return next;
}

// --- the transforms ---------------------------------------------------------

// imports/lib/crypto.js -> CommonJS, exactly the crypto-selftest.cjs technique.
function transformCryptoJs() {
  let source = readRepo(CRYPTO_JS);
  source = substitute(source, "Npm.require('crypto')", "require('crypto')",
    'rewrite Npm.require to require in crypto.js');
  source = substitute(source, /^export /gm, '', 'strip the ESM export keyword from crypto.js');
  // encryptFor/decryptFor are the domain-keyed pair the CSAF binding uses; hmac is
  // exported so the blind-index value can be pinned across the shared key
  // derivation both of them now go through.
  return `${source}\nmodule.exports = {encrypt, decrypt, encryptFor, decryptFor, hmac, VERSION_PREFIX};\n`;
}

// imports/server/csaf/productId.js -> CommonJS, with its two imports pointed at
// the transformed crypto.js and the REAL (already CommonJS) codec.
function transformProductIdJs(cryptoPath) {
  let source = readRepo(PRODUCT_ID_JS);
  source = substitute(
    source,
    /^import\s*\{([^}]*)\}\s*from\s*'\/imports\/lib\/crypto';?[ \t]*$/m,
    (_match, names) => `const {${names}} = require(${JSON.stringify(cryptoPath)});`,
    'redirect the crypto.js import in productId.js');
  source = substitute(
    source,
    /^import\s*\{([^}]*)\}\s*from\s*'\.\/productIdCodec';?[ \t]*$/m,
    (_match, names) => `const {${names}} = require(${JSON.stringify(path.join(REPO_ROOT, CODEC_JS))});`,
    'redirect the codec import in productId.js');
  source = substitute(source, /^export const /gm, 'const ',
    'strip the ESM export keyword from productId.js');
  return `${source}\nmodule.exports = {encodeProductId, decodeProductId, encodeIdMap};\n`;
}

const CRYPTO_SOURCE = transformCryptoJs();
const CRYPTO_PATH = materialize('crypto', CRYPTO_SOURCE);
const PRODUCT_ID_SOURCE = transformProductIdJs(CRYPTO_PATH);
const PRODUCT_ID_PATH = materialize('product-id', PRODUCT_ID_SOURCE);

// eslint-disable-next-line import/no-dynamic-require
const realCrypto = require(CRYPTO_PATH);
// eslint-disable-next-line import/no-dynamic-require
const binding = require(PRODUCT_ID_PATH);
const {encodeProductId, decodeProductId, encodeIdMap} = binding;

let savedKey;

beforeAll(() => {
  savedKey = process.env.TS_ENCRYPTION_KEY;
});

beforeEach(() => {
  // Set explicitly rather than relying on the ambient environment, so the round
  // trip below is never silently exercising crypto.js's weak built-in fallback.
  process.env.TS_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  if (savedKey === undefined) {
    delete process.env.TS_ENCRYPTION_KEY;
  } else {
    process.env.TS_ENCRYPTION_KEY = savedKey;
  }
  tempFiles.forEach((file) => {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      // Best effort: a leftover file in the OS temp dir is harmless, and throwing
      // out of afterAll would mask the real result of the run.
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  });
});

// The independent verifier. Deliberately built from Node's crypto directly, NOT
// from the transformed crypto.js, so a broken transform cannot make it agree with
// itself.
function decryptIndependently(token, key = CSAF_SECRET) {
  const payload = Buffer.from(token.slice('v2:'.length), 'base64');
  const decipher = nodeCrypto.createDecipheriv(
    'aes-256-gcm',
    nodeCrypto.createHash('sha256').update(key, 'utf8').digest(),
    payload.subarray(0, IV_LEN));
  decipher.setAuthTag(payload.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return decipher.update(payload.subarray(IV_LEN + TAG_LEN), undefined, 'utf8') + decipher.final('utf8');
}

// ---------------------------------------------------------------------------

describe('the transform really loaded the shipped source, not a stand-in', () => {
  it('materialised both modules from the repo files', () => {
    expect(CRYPTO_SOURCE).toContain('aes-256-gcm');
    expect(PRODUCT_ID_SOURCE).toContain('createProductIdCodec');
    // Nothing ESM survived: a leftover `import`/`export` statement would have made
    // the require throw, but assert it so the intent is explicit rather than
    // incidental.
    expect(PRODUCT_ID_SOURCE.match(/^\s*(?:import|export)\s/gm)).toBeNull();
    expect(CRYPTO_SOURCE.match(/^\s*(?:import|export)\s/gm)).toBeNull();
  });

  it('the binding exposes the three entry points its callers import', () => {
    expect(typeof encodeProductId).toBe('function');
    expect(typeof decodeProductId).toBe('function');
    expect(typeof encodeIdMap).toBe('function');
  });

  it('crypto.js exports VERSION_PREFIX, and it is the value the binding routes on', () => {
    // An unexported VERSION_PREFIX would arrive as undefined and the codec factory
    // would throw at construction - which is exactly what should happen, and is
    // worth pinning because the binding imports it rather than declaring it.
    expect(realCrypto.VERSION_PREFIX).toBe('v2:');
  });
});

describe('AC1/AC2 through the real cipher: round trip and fresh IV', () => {
  const MODULE_ID = 'abc123def456ghi7';

  it('encodes to a v2: token that decodes back to the exact id', () => {
    const token = encodeProductId(MODULE_ID);
    expect(token.startsWith(realCrypto.VERSION_PREFIX)).toBe(true);
    expect(decodeProductId(token)).toBe(MODULE_ID);
  });

  it('the token is genuinely AES-256-GCM under the CSAF subkey of TS_ENCRYPTION_KEY', () => {
    // The load-bearing assertion of this file. It does not go through crypto.js,
    // the codec, or the transform - it takes the shipped token apart with Node's
    // own cipher. If this passes, the binding is wired to the real at-rest scheme,
    // keyed on the domain subkey rather than on the raw credential key.
    const token = encodeProductId(MODULE_ID);
    expect(decryptIndependently(token, CSAF_SECRET)).toBe(MODULE_ID);
    // ...and NOT on the credential key itself. See the domain-separation block.
    expect(() => decryptIndependently(token, TEST_KEY)).toThrow();
  });

  it('mints a fresh IV per call, so the same id never yields the same token twice', () => {
    const tokens = new Set();
    for (let i = 0; i < 25; i += 1) {
      const token = encodeProductId(MODULE_ID);
      tokens.add(token);
      expect(decodeProductId(token)).toBe(MODULE_ID);
    }
    expect(tokens.size).toBe(25);
    // And the IV really is the varying part: same plaintext, different 12-byte head.
    const ivs = new Set([...tokens].map(
      (token) => Buffer.from(token.slice(3), 'base64').subarray(0, IV_LEN).toString('hex')));
    expect(ivs.size).toBe(25);
  });

  it('100 successive encodes all use the v2: scheme and round-trip', () => {
    for (let i = 0; i < 100; i += 1) {
      const token = encodeProductId(`m-${i}`);
      expect(token.startsWith('v2:')).toBe(true);
      expect(decodeProductId(token)).toBe(`m-${i}`);
    }
  });
});

describe('the key really comes from the environment, per call', () => {
  it('a token minted under one key does not decode under another', () => {
    const token = encodeProductId('m-env');
    process.env.TS_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(decodeProductId(token)).toBeUndefined();
    // Non-vacuity: it is the KEY that made the difference, not a broken token.
    process.env.TS_ENCRYPTION_KEY = TEST_KEY;
    expect(decodeProductId(token)).toBe('m-env');
  });

  it('GCM authentication holds: one flipped byte in the tag makes it undecodable', () => {
    const token = encodeProductId('m-tamper');
    const payload = Buffer.from(token.slice(3), 'base64');
    payload[IV_LEN] ^= 0xff;
    const tampered = `v2:${payload.toString('base64')}`;
    expect(tampered).not.toBe(token);
    expect(decodeProductId(tampered)).toBeUndefined();
    // Non-vacuity: the untampered token still decodes, so this is authentication
    // rejecting the edit rather than the decode path being broken for everything.
    expect(decodeProductId(token)).toBe('m-tamper');
  });
});

describe('domain separation: CSAF tokens and credential ciphertexts share a secret, not a key', () => {
  // Security review finding 3. TS_ENCRYPTION_KEY also encrypts Jira/TFS/GitHub/
  // ScanOSS credentials, REST API keys, external API keys and PSIRT keys. Modules
  // has no attached schema and imports/lib/interactors/modules/create.js inserts
  // the client object verbatim, so a caller CHOOSES the module _id and therefore
  // the plaintext. Encrypting product_ids under the credential key directly made
  // CSAF.EncodeModuleIds a chosen-plaintext oracle for that key, and
  // CSAF.DecodeProductIds a decrypt oracle for any ciphertext written with it.
  //
  // The subkey closes both directions: neither reader can read the other's
  // ciphertext, because GCM authentication fails under the wrong key.

  it('crypto.js decrypt() - the credential reader - cannot read a product_id token', () => {
    const token = encodeProductId('m-domain-sep');
    expect(token.startsWith('v2:')).toBe(true);
    expect(realCrypto.decrypt(token)).toBeUndefined();
  });

  it('decodeProductId cannot read a credential ciphertext', () => {
    const credential = realCrypto.encrypt('jira-service-account-password');
    expect(credential.startsWith('v2:')).toBe(true);
    // Non-vacuity: the credential reader DOES read it, so the line above is the
    // key separation refusing, not an unreadable value.
    expect(realCrypto.decrypt(credential)).toBe('jira-service-account-password');
    expect(decodeProductId(credential)).toBeUndefined();
  });

  it('is not a chosen-plaintext oracle: a chosen id never yields a credential-key ciphertext', () => {
    const chosen = 'attacker-chosen-plaintext-value';
    const token = encodeProductId(chosen);
    expect(realCrypto.decrypt(token)).toBeUndefined();
    expect(() => decryptIndependently(token, TEST_KEY)).toThrow();
    // ...while the CSAF reader still round-trips it, so the id itself is fine.
    expect(decodeProductId(token)).toBe(chosen);
  });

  it('the subkey is sha256(secret|domain), derived per call from the environment', () => {
    const token = encodeProductId('m-derivation');
    expect(decryptIndependently(token, `${TEST_KEY}|${CSAF_KEY_DOMAIN}`)).toBe('m-derivation');
    process.env.TS_ENCRYPTION_KEY = 'another-environment-secret';
    const rotated = encodeProductId('m-derivation');
    expect(decryptIndependently(rotated, `another-environment-secret|${CSAF_KEY_DOMAIN}`))
      .toBe('m-derivation');
    expect(() => decryptIndependently(rotated, `${TEST_KEY}|${CSAF_KEY_DOMAIN}`)).toThrow();
  });

  it('the credential scheme itself is untouched: v2 round trip and blind index unchanged', () => {
    // The subkey is threaded through a shared key derivation inside crypto.js, so
    // pin the two values that would silently break stored data if it drifted: the
    // credential ciphertext must still be readable, and hmac() - the blind index
    // that REST API-key lookup matches on - must still be keyed on
    // sha256(secret|hmac-v1), byte for byte.
    expect(realCrypto.decrypt(realCrypto.encrypt('stored-credential'))).toBe('stored-credential');
    expect(realCrypto.hmac('an-api-key')).toBe(
      nodeCrypto.createHmac('sha256', nodeCrypto.createHash('sha256').update(HMAC_SECRET, 'utf8').digest())
        .update('an-api-key', 'utf8').digest('hex'));
  });
});

describe('prefix routing is load-bearing at the binding layer, not just in the codec', () => {
  // crypto.js's own no-prefix branch is AES-256-CBC-hex, for stored integration
  // credentials - a completely different data set. A CSAF product_id that is not
  // v2:-prefixed must never reach it. The codec unit spec asserts this against an
  // injected decrypt; here the REAL decrypt is on the other side of the routing
  // decision, so the test is about what actually ships.
  // crypto.js keeps no built-in pre-rotation password; it reads
  // TS_ENCRYPTION_KEY_LEGACY, which the tests below set to this invented one.
  const SPEC_LEGACY_PASSWORD = 'csaf-real-crypto-spec-legacy-password';

  beforeEach(() => {
    process.env.TS_ENCRYPTION_KEY_LEGACY = SPEC_LEGACY_PASSWORD;
  });

  afterEach(() => {
    delete process.env.TS_ENCRYPTION_KEY_LEGACY;
  });

  function cryptoJsLegacyCbcHex(plaintext) {
    const password = SPEC_LEGACY_PASSWORD;
    const pwd = Buffer.from(password, 'utf8');
    const out = Buffer.alloc(48);
    let d = Buffer.alloc(0);
    let filled = 0;
    while (filled < 48) {
      const hash = nodeCrypto.createHash('md5');
      hash.update(d);
      hash.update(pwd);
      d = hash.digest();
      d.copy(out, filled);
      filled += d.length;
    }
    const cipher = nodeCrypto.createCipheriv('aes-256-cbc', out.subarray(0, 32), out.subarray(32, 48));
    return cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  }

  it('a crypto.js CBC-legacy value is NOT decoded as a product_id', () => {
    const hex = cryptoJsLegacyCbcHex('someCredentialValue');
    expect(hex.startsWith('v2:')).toBe(false);
    expect(decodeProductId(hex)).toBeUndefined();
  });

  it('NON-VACUITY: crypto.js decrypt() itself DOES read that same value', () => {
    // Proves the previous assertion is the routing gate refusing to hand a
    // non-CSAF token to decrypt(), not simply an unreadable input.
    const hex = cryptoJsLegacyCbcHex('someCredentialValue');
    expect(realCrypto.decrypt(hex)).toBe('someCredentialValue');
  });
});

describe('AC6 through the real binding: undecodable input yields undefined, never garbage', () => {
  const CASES = [
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['a number', 42],
    ['an object', {}],
    ['an array', []],
    ['v2: with non-base64 body', 'v2:not-base64!!!'],
    ['v2: with an empty body', 'v2:'],
    ['an arbitrary string', 'hello'],
    ['a bare purl', 'pkg:npm/left-pad@1.0.0']
  ];

  CASES.forEach(([label, value]) => {
    it(`returns undefined for ${label}`, () => {
      expect(decodeProductId(value)).toBeUndefined();
    });
  });
});

describe('encodeIdMap through the real cipher', () => {
  it('AC17: one decodable token per distinct id', () => {
    const map = encodeIdMap(['m1', 'm2', 'm2']);
    expect(Object.keys(map).sort()).toEqual(['m1', 'm2']);
    expect(decodeProductId(map.m1)).toBe('m1');
    expect(decodeProductId(map.m2)).toBe('m2');
    expect(map.m1.startsWith('v2:')).toBe(true);
  });

  it('an empty or missing id list is an empty map, never undefined', () => {
    // The frontend depends on this: CSAF.EncodeModuleIds([]) must resolve to {},
    // because fromVulnerabilityReport rejects when productIds is not an object.
    expect(encodeIdMap([])).toEqual({});
    expect(encodeIdMap(undefined)).toEqual({});
  });

  it('a `__proto__` id becomes an OWN key and does not touch the prototype', () => {
    const map = encodeIdMap(['__proto__', 'm1']);
    expect(Object.prototype.hasOwnProperty.call(map, '__proto__')).toBe(true);
    expect(typeof map.m1).toBe('string');
    expect(decodeProductId(Object.getOwnPropertyDescriptor(map, '__proto__').value)).toBe('__proto__');
    // Both directions: the prototype chain is untouched.
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect({}.polluted).toBeUndefined();
  });

  it('refuses an unusable id rather than emitting a hole in the map', () => {
    expect(() => encodeIdMap(['m1', ''])).toThrow('CSAF productId: id must be a non-empty string');
    expect(() => encodeIdMap(['m1', 42])).toThrow('CSAF productId: id must be a non-empty string');
  });
});

describe('AC16 end to end: the raw module _id never survives into a token', () => {
  it('the id is not recoverable from the token without the key', () => {
    const rawId = 'rawModuleIdentifier01';
    const token = encodeProductId(rawId);
    expect(token).not.toContain(rawId);
    expect(Buffer.from(token.slice(3), 'base64').toString('latin1')).not.toContain(rawId);
    // ...and the URI shape vex.js builds around it carries no raw id either.
    expect(`https://app.example.io/module/${encodeURIComponent(token)}`).not.toContain(rawId);
  });
});

// Self-test for imports/lib/crypto.js (run: `yarn test:crypto` or
// `node tools/security/crypto-selftest.cjs`). Loads the real source, transformed
// to runnable CommonJS (Npm.require -> require, strip the ESM export keyword), so
// it exercises the actual implementation rather than a copy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const srcPath = path.join(__dirname, '..', '..', 'imports', 'lib', 'crypto.js');
// `/^export /gm`, not `/export function/g`: crypto.js also exports a const
// (VERSION_PREFIX), and leaving that one `export` in place made this whole
// self-test die with `SyntaxError: Unexpected token 'export'` before running a
// single assertion.
const transformed = fs.readFileSync(srcPath, 'utf8')
  .replace("Npm.require('crypto')", "require('crypto')")
  .replace(/^export /gm, '')
  + '\nmodule.exports = {encrypt, decrypt, encryptFor, decryptFor, hmac, maskKey, decryptV2Only};\n';
const tmp = path.join(os.tmpdir(), `crypto-selftest-${process.pid}.cjs`);
fs.writeFileSync(tmp, transformed);
let encrypt, decrypt, encryptFor, decryptFor, hmac, maskKey, decryptV2Only;
try { ({encrypt, decrypt, encryptFor, decryptFor, hmac, maskKey, decryptV2Only} = require(tmp)); } finally { fs.unlinkSync(tmp); }

let pass = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS', l); } else { console.log('  FAIL', l); process.exitCode = 1; } };

// crypto.js has no built-in key: every step runs under an explicit one, and the
// legacy step under an invented pre-rotation password.
const BASE_KEY = 'selftest-base-encryption-key';
process.env.TS_ENCRYPTION_KEY = BASE_KEY;
process.env.TS_ENCRYPTION_KEY_LEGACY = 'selftest-legacy-password';

// 1. v2 roundtrip
{ const ct = encrypt('hunter2');
  ok(typeof ct === 'string' && ct.startsWith('v2:'), 'encrypt produces v2: prefix');
  ok(decrypt(ct) === 'hunter2', 'v2 roundtrip'); }

// 2. random IV - same plaintext yields different ciphertexts (no static IV)
ok(encrypt('same') !== encrypt('same'), 'random IV -> different ciphertexts');

// 3. GCM authentication - a flipped byte must fail to decrypt
{ const ct = encrypt('secret'); const b = Buffer.from(ct.slice(3), 'base64'); b[b.length - 1] ^= 0xff;
  ok(decrypt('v2:' + b.toString('base64')) === undefined, 'GCM rejects tampered ciphertext'); }

// 4. legacy back-compat - a no-prefix CBC ciphertext (pre-rotation) still decrypts
{ const PASS = process.env.TS_ENCRYPTION_KEY_LEGACY;
  const pwd = Buffer.from(PASS); let d = Buffer.alloc(0); const res = Buffer.alloc(48); let f = 0;
  while (f < 48) { const h = crypto.createHash('md5'); h.update(d); h.update(pwd); d = h.digest(); d.copy(res, f); f += d.length; }
  const c = crypto.createCipheriv('aes-256-cbc', res.subarray(0, 32), res.subarray(32, 48));
  const hex = c.update('legacy-token', 'utf8', 'hex') + c.final('hex');
  ok(decrypt(hex) === 'legacy-token', 'legacy (no-prefix hex) still decrypts'); }

// 5. env key - key is read per call; data is unreadable under a different key
{ process.env.TS_ENCRYPTION_KEY = 'super-strong-random-key-123';
  const ct = encrypt('envsecret');
  ok(decrypt(ct) === 'envsecret', 'env-key roundtrip');
  process.env.TS_ENCRYPTION_KEY = 'a-totally-different-key';
  ok(decrypt(ct) === undefined, 'wrong key cannot decrypt (auth fail)');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 6. safe on empty / non-string
ok(decrypt(undefined) === undefined && decrypt('') === undefined, 'safe on empty/undefined');

// 7. hmac - deterministic, hex-encoded sha256 output
ok(hmac('samevalue') === hmac('samevalue'), 'hmac is deterministic for the same input');
ok(/^[0-9a-f]{64}$/.test(hmac('samevalue')), 'hmac returns 64-char lowercase hex (sha256)');

// 8. hmac - key-dependent (different TS_ENCRYPTION_KEY -> different hash)
{ process.env.TS_ENCRYPTION_KEY = 'hmac-key-one';
  const h1 = hmac('samevalue');
  process.env.TS_ENCRYPTION_KEY = 'hmac-key-two';
  const h2 = hmac('samevalue');
  ok(h1 !== h2, 'hmac output depends on TS_ENCRYPTION_KEY');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 9. hmac - domain-separated from the AES-GCM key (not literally the same digest)
{ process.env.TS_ENCRYPTION_KEY = 'shared-secret-key';
  const h = hmac('probe');
  const aesKey = crypto.createHash('sha256').update('shared-secret-key', 'utf8').digest('hex');
  ok(h !== aesKey, 'hmac subkey is domain-separated from the raw AES-GCM key derivation');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 10. hmac - safe on empty/undefined input (never throws)
ok(typeof hmac('') === 'string' && hmac('').length === 64, 'hmac safe on empty string');
ok(typeof hmac(undefined) === 'string' && hmac(undefined).length === 64, 'hmac safe on undefined');

// 11. maskKey - byte-parity with the reference client getVisibleKey() algorithm
{ function getVisibleKey(apiKey) {
    if (apiKey) {
      let newKey = apiKey.split('-');
      return `${newKey[0].substring(0, 4)}...${newKey[newKey.length - 1].slice(-4)}`;
    }
  }
  const sample = 'a1b2c3d4-e5f6-7890-aaaa-bbbbccccdddd';
  ok(maskKey(sample) === getVisibleKey(sample), 'maskKey matches the reference getVisibleKey byte-for-byte');
  ok(maskKey(sample) === 'a1b2...dddd', 'maskKey produces the expected first4...last4 format'); }

// 12. maskKey - safe on empty/undefined input
ok(maskKey('') === undefined && maskKey(undefined) === undefined, 'maskKey safe on empty/undefined');

// 13. decryptV2Only - v2:-prefixed input decrypts, same as decrypt()
{ const ct = encrypt('v2-only-plain');
  ok(decryptV2Only(ct) === 'v2-only-plain', 'decryptV2Only decrypts a v2:-prefixed value'); }

// 14. decryptV2Only - genuinely-plaintext (non-v2:) input passes through UNCHANGED.
// This is the whole point of the function: unlike decrypt(), it must NOT run
// non-v2: input through the legacy CBC branch (which would corrupt a genuinely
// plaintext apiKeys[].key / externalApiKeys.*.value during the transitional
// window before TS_REENCRYPT_SECRETS has run). Contrast directly against
// decrypt() on the exact same input to prove this is a real behavioral
// difference, not a no-op wrapper.
{ const plain = 'genuinely-plaintext-not-legacy-ciphertext';
  ok(decryptV2Only(plain) === plain, 'decryptV2Only passes non-v2: input through unchanged');
  ok(decrypt(plain) !== plain,
    'sanity: decrypt() does NOT pass the same input through unchanged (proves decryptV2Only differs from decrypt(), not a duplicate)'); }

// 15. decryptV2Only - safe on empty/undefined/non-string input (mirrors input as-is, never throws)
ok(decryptV2Only(undefined) === undefined, 'decryptV2Only safe on undefined');
ok(decryptV2Only('') === '', 'decryptV2Only safe on empty string (returns it as-is)');
ok(decryptV2Only(42) === 42, 'decryptV2Only safe on a non-string value (returns it as-is)');

// 16. decryptV2Only - GCM authentication still applies to the v2: branch (a
// tampered v2: ciphertext fails, it is not silently treated as plaintext)
{ const ct = encrypt('tamper-me-v2only'); const b = Buffer.from(ct.slice(3), 'base64'); b[b.length - 1] ^= 0xff;
  ok(decryptV2Only('v2:' + b.toString('base64')) === undefined,
    'decryptV2Only rejects a tampered v2:-prefixed ciphertext (returns undefined, not garbage)'); }

// 17. encryptFor/decryptFor - domain-keyed variants round-trip under their own domain
{ process.env.TS_ENCRYPTION_KEY = 'domain-sep-secret';
  const ct = encryptFor('some-domain', 'domain-plain');
  ok(typeof ct === 'string' && ct.startsWith('v2:'), 'encryptFor produces a v2: ciphertext');
  ok(decryptFor('some-domain', ct) === 'domain-plain', 'encryptFor/decryptFor round-trip');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 18. encryptFor - the key really is separated, in BOTH directions. This is the
// containment property: a data set encrypted for a domain must be unreadable by
// the credential reader, and a credential ciphertext unreadable by the domain
// reader, even though both read the same TS_ENCRYPTION_KEY.
{ process.env.TS_ENCRYPTION_KEY = 'domain-sep-secret';
  const domainCt = encryptFor('some-domain', 'domain-plain');
  ok(decrypt(domainCt) === undefined, 'the credential reader cannot read a domain ciphertext');
  const credentialCt = encrypt('credential-plain');
  ok(decrypt(credentialCt) === 'credential-plain', 'sanity: the credential reader reads its own ciphertext');
  ok(decryptFor('some-domain', credentialCt) === undefined, 'a domain reader cannot read a credential ciphertext');
  ok(decryptFor('another-domain', domainCt) === undefined, 'one domain cannot read another domain');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 19. decryptFor - current scheme only. A domain has no pre-rotation data, so a
// non-v2: value must never reach the legacy CBC branch.
{ process.env.TS_ENCRYPTION_KEY = 'domain-sep-secret';
  ok(decryptFor('some-domain', 'plain-not-a-ciphertext') === undefined, 'decryptFor ignores non-v2: input');
  ok(decryptFor('some-domain', undefined) === undefined && decryptFor('some-domain', '') === undefined,
    'decryptFor safe on empty/undefined');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; }

// 20. no built-in key - legacy decrypt needs TS_ENCRYPTION_KEY_LEGACY, and with
// neither variable set nothing is encrypted or hashed
{ const PASS = process.env.TS_ENCRYPTION_KEY_LEGACY;
  const pwd = Buffer.from(PASS); let d = Buffer.alloc(0); const res = Buffer.alloc(48); let f = 0;
  while (f < 48) { const h = crypto.createHash('md5'); h.update(d); h.update(pwd); d = h.digest(); d.copy(res, f); f += d.length; }
  const c = crypto.createCipheriv('aes-256-cbc', res.subarray(0, 32), res.subarray(32, 48));
  const hex = c.update('legacy-token', 'utf8', 'hex') + c.final('hex');
  delete process.env.TS_ENCRYPTION_KEY_LEGACY;
  ok(decrypt(hex) === undefined, 'legacy data is unreadable without TS_ENCRYPTION_KEY_LEGACY');
  delete process.env.TS_ENCRYPTION_KEY;
  ok(encrypt('x') === undefined, 'encrypt refuses to run without any key');
  let threw = false; try { hmac('x'); } catch (e) { threw = /TS_ENCRYPTION_KEY/.test(e.message); }
  ok(threw, 'hmac throws without any key');
  process.env.TS_ENCRYPTION_KEY = BASE_KEY; process.env.TS_ENCRYPTION_KEY_LEGACY = PASS; }

console.log(`\ncrypto self-test: ${pass} assertions passed`);
if (process.exitCode) { console.log('crypto self-test FAILED'); }

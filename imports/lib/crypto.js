/* global Npm: false */
const crypto = Npm.require('crypto');

// ---------------------------------------------------------------------------
// At-rest encryption for stored integration credentials (Jira/TFS/GitHub/
// ScanOSS tokens & passwords). Server-only (Npm.require('crypto')).
//
// Current scheme (`v2:`): AES-256-GCM (authenticated) with a key derived from
// the TS_ENCRYPTION_KEY environment secret and a fresh random IV per record.
//
// Legacy scheme (no prefix): AES-256-CBC with a key/IV derived from a static
// password via OpenSSL EVP_BytesToKey (MD5). This is cryptographically weak
// (static key and IV, unauthenticated) and is retained ONLY to keep reading
// credentials written before key rotation. New values are never written with
// it. The password is not in the source: an environment holding such data sets
// it as TS_ENCRYPTION_KEY_LEGACY. Once a re-encryption migration has rewritten
// all stored values to `v2:`, the legacy block can be removed.
// ---------------------------------------------------------------------------

// Exported so a caller that must VERIFY encrypt() actually produced a
// current-scheme ciphertext (encrypt swallows its own failure and returns
// undefined) can check the prefix against this single declaration rather than
// hard-coding a second copy of the literal.
export const VERSION_PREFIX = 'v2:';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;   // 96-bit nonce (GCM recommended)
const TAG_LEN = 16;

// --- Legacy (decrypt-only) -------------------------------------------------
const LEGACY_ALGORITHM = 'aes-256-cbc';

// The pre-rotation password. Read per call, like TS_ENCRYPTION_KEY, so it is
// never captured when the module loads.
function legacyPassword() {
  return process.env.TS_ENCRYPTION_KEY_LEGACY;
}

// Replicate OpenSSL EVP_BytesToKey (MD5-based) used by the removed
// createCipher/createDecipher, for backward compatibility with pre-rotation data.
function evpBytesToKey(password, keyLen, ivLen) {
  const pwd = Buffer.from(password, 'utf8');
  let d = Buffer.alloc(0);
  const result = Buffer.alloc(keyLen + ivLen);
  let filled = 0;
  while (filled < keyLen + ivLen) {
    const hash = crypto.createHash('md5');
    hash.update(d);
    hash.update(pwd);
    d = hash.digest();
    d.copy(result, filled);
    filled += d.length;
  }
  return {
    key: result.subarray(0, keyLen),
    iv: result.subarray(keyLen, keyLen + ivLen)
  };
}

// Derive the legacy key and IV once per password, not on every decrypt.
let legacyKeyCache = null;

function legacyKeyAndIv(password) {
  if (!legacyKeyCache || legacyKeyCache.password !== password) {
    legacyKeyCache = Object.assign({password}, evpBytesToKey(password, 32, 16));
  }
  return legacyKeyCache;
}

let warnedMissingLegacyPassword = false;

function decryptLegacy(text) {
  const password = legacyPassword();
  if (!password) {
    if (!warnedMissingLegacyPassword) {
      console.log('Exception in decryption (legacy): TS_ENCRYPTION_KEY_LEGACY is not set, ' +
        'so credentials stored before the key rotation cannot be read');
      warnedMissingLegacyPassword = true;
    }
    return undefined;
  }
  try {
    const {key, iv} = legacyKeyAndIv(password);
    const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, iv);
    let decrypted = decipher.update(text, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.log('Exception in decryption (legacy)', error.message);
  }
}

// --- Current scheme --------------------------------------------------------
let warnedMissingKey = false;

// The environment secret every current-scheme key is derived from. Without
// TS_ENCRYPTION_KEY it falls back to TS_ENCRYPTION_KEY_LEGACY: an environment
// that ran without a key wrote its data under the pre-rotation password, and
// keeps reading it once that variable is set. With neither there is no key at
// all - throw rather than encrypt under a value anyone could know.
function resolveSecret() {
  const secret = process.env.TS_ENCRYPTION_KEY;
  if (secret) {
    return String(secret);
  }
  const legacy = legacyPassword();
  if (!legacy) {
    throw new Error('TS_ENCRYPTION_KEY is not set (and no TS_ENCRYPTION_KEY_LEGACY to fall back to)');
  }
  if (!warnedMissingKey) {
    console.warn('[crypto] TS_ENCRYPTION_KEY is not set - encrypting at-rest credentials with ' +
      'TS_ENCRYPTION_KEY_LEGACY, the pre-rotation password. Set TS_ENCRYPTION_KEY to a strong ' +
      'random secret in every non-development environment.');
    warnedMissingKey = true;
  }
  return String(legacy);
}

// Key rotation: the key the data was written with before TS_ENCRYPTION_KEY was
// changed. Values are read with TS_ENCRYPTION_KEY first and this second, and
// TS_REENCRYPT_SECRETS=true rewrites them with the new key
// (imports/startup/server/reencrypt-secrets.js). Read per call.
function previousSecret() {
  const secret = process.env.TS_ENCRYPTION_KEY_PREVIOUS;
  return secret ? String(secret) : null;
}

// Derive a 32-byte key from the (arbitrary-length) secret. Passing a `domain`
// derives an INDEPENDENT subkey for a different data set under the same
// environment secret, so a value encrypted for one domain can neither be read
// nor minted through another - GCM authentication fails under the wrong key.
// Without a domain this is the stored-credential key, unchanged.
function deriveKey(secret, domain) {
  return crypto.createHash('sha256')
    .update(domain ? `${secret}|${domain}` : secret, 'utf8').digest();
}

function getKey(domain) {
  return deriveKey(resolveSecret(), domain);
}

function getPreviousKey(domain) {
  const secret = previousSecret();
  return secret ? deriveKey(secret, domain) : null;
}

// Domain-separated subkey for HMAC (blind-index) use - independent of the
// AES-GCM key derived above (key separation between the two primitives), so a
// primitive-confusion issue in one scheme cannot leak into the other.
const HMAC_DOMAIN = 'hmac-v1';

function getHmacKey() {
  return getKey(HMAC_DOMAIN);
}

function gcmEncrypt(key, text) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function gcmDecrypt(key, payload) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = data.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

// Decrypt a `v2:` payload with the current key, then the previous one.
// `previous` tells whether the previous key was needed (the value is due for
// re-encryption). Throws when neither key authenticates it.
function gcmDecryptRotating(domain, payload) {
  try {
    return {plain: gcmDecrypt(getKey(domain), payload), previous: false};
  } catch (error) {
    const previousKey = getPreviousKey(domain);
    if (!previousKey) {
      throw error;
    }
    return {plain: gcmDecrypt(previousKey, payload), previous: true};
  }
}

// Deterministic keyed hash ("blind index") for a plaintext value, used where a
// stored ciphertext must be matched against a presented plaintext (e.g. REST
// API-key lookup) without an unindexed decrypt-and-compare scan. NOT reversible.
export function hmac(text) {
  return crypto.createHmac('sha256', getHmacKey()).update(String(text), 'utf8').digest('hex');
}

// Every blind index a presented value may be stored under: the current one and,
// during a key rotation, the one made with TS_ENCRYPTION_KEY_PREVIOUS. Lookups
// match against all of them so keys keep working until they are re-hashed.
export function hmacCandidates(text) {
  const hashes = [hmac(text)];
  const previousKey = getPreviousKey(HMAC_DOMAIN);
  if (previousKey) {
    hashes.push(crypto.createHmac('sha256', previousKey).update(String(text), 'utf8').digest('hex'));
  }
  return hashes;
}

// True for a `v2:` value that only the previous key (TS_ENCRYPTION_KEY_PREVIOUS)
// can read, i.e. one the re-encryption still has to rewrite.
export function isEncryptedWithPreviousKey(text) {
  if (typeof text !== 'string' || !text.startsWith(VERSION_PREFIX) || !previousSecret()) {
    return false;
  }
  try {
    return gcmDecryptRotating(undefined, text.slice(VERSION_PREFIX.length)).previous;
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (error) {
    return false;
  }
}

// Non-secret display mask for a secret/key value: first4...last4 of the
// hyphen-split value (mirrors the client's historical getVisibleKey()
// algorithm, relocated server-side so the stored maskedKey renders identically
// to the previous live-computed mask). Returns undefined for empty input.
export function maskKey(text) {
  if (!text) {
    return undefined;
  }
  const parts = String(text).split('-');
  return `${parts[0].substring(0, 4)}...${parts[parts.length - 1].slice(-4)}`;
}

export function encrypt(text) {
  try {
    return gcmEncrypt(getKey(), text);
  } catch (error) {
    console.log('Exception in encryption', error.message);
  }
}

function decryptV2(payload) {
  try {
    return gcmDecryptRotating(undefined, payload).plain;
  } catch (error) {
    console.log('Exception in decryption', error.message);
  }
}

// --- Domain-separated variants ---------------------------------------------
// For data sets that must NOT share a key with the stored credentials above,
// even though they read the same TS_ENCRYPTION_KEY. Current user: the CSAF/VEX
// product_id codec (imports/server/csaf/productId.js), whose plaintexts are
// client-chosen document ids and whose ciphertexts are published in advisories.
//
// Current scheme only: these never fall back to the legacy CBC branch, because a
// domain has no pre-rotation data by definition.

export function encryptFor(domain, text) {
  try {
    return gcmEncrypt(getKey(domain), text);
  } catch (error) {
    console.log('Exception in encryption', error.message);
  }
}

export function decryptFor(domain, text) {
  if (typeof text !== 'string' || !text.startsWith(VERSION_PREFIX)) {
    return undefined;
  }
  try {
    return gcmDecryptRotating(domain, text.slice(VERSION_PREFIX.length)).plain;
  // Deliberately NOT logged, unlike decryptV2 above. A failure here is an
  // ordinary outcome (a stale, forged or foreign-key token in a document a caller
  // uploaded), and the call is reachable in bulk from a DDP method - logging per
  // failure would let request content drive the log volume.
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (error) {
    return undefined;
  }
}

export function decrypt(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return undefined;
  }
  if (text.startsWith(VERSION_PREFIX)) {
    return decryptV2(text.slice(VERSION_PREFIX.length));
  }
  return decryptLegacy(text);   // backward compatibility with pre-rotation data
}

// For fields that were introduced encrypted directly at v2: (apiKeys[].key)
// - unlike jira.passwd/tfs.token/etc, these never had a
// legacy (pre-v2) ciphertext form; a value without the v2: prefix here is
// genuinely plaintext (not legacy ciphertext), so - unlike decrypt() - do NOT
// run it through the legacy CBC branch, which would corrupt it (confirmed: CBC
// decrypt of arbitrary plaintext throws/returns undefined). Used by read sites
// so they keep working during the transitional window before the one-time
// TS_REENCRYPT_SECRETS migration has run against pre-existing data.
export function decryptV2Only(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }
  return text.startsWith(VERSION_PREFIX) ? decryptV2(text.slice(VERSION_PREFIX.length)) : text;
}

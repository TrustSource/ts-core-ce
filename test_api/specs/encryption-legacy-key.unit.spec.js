/* eslint-disable no-undef */
// The pre-rotation encryption password lives in TS_ENCRYPTION_KEY_LEGACY, not in
// the source.
//
// It used to be a literal in imports/lib/crypto.js (and a copy in the signature
// model) with three jobs: decrypting credentials written before the 3.1.1 key
// rotation, and standing in as the AES-GCM, blind-index and signing key whenever
// TS_ENCRYPTION_KEY was unset. A key printed in the source protects nothing, so:
//
//   - legacy decrypt works only with TS_ENCRYPTION_KEY_LEGACY set;
//   - without TS_ENCRYPTION_KEY, encryption and signing fall back to
//     TS_ENCRYPTION_KEY_LEGACY (environments that ran without a key keep reading
//     their data once it is set), and with neither they fail loudly;
//   - a production server with neither variable refuses to start.
//
// crypto.js is loaded as runnable CommonJS with the crypto-selftest.cjs transform,
// so the real implementation is exercised. Only an invented password is used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');

const REPO = path.join(__dirname, '../..');
const SPEC_LEGACY_PASSWORD = 'spec-only-legacy-password';

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

const cryptoPath = path.join(os.tmpdir(), `encryption-legacy-key-${process.pid}.cjs`);
fs.writeFileSync(cryptoPath, read('imports/lib/crypto.js')
  .replace("Npm.require('crypto')", "require('crypto')")
  .replace(/^export /gm, '')
  + '\nmodule.exports = {encrypt, decrypt, hmac};\n');
// eslint-disable-next-line import/no-dynamic-require
const {encrypt, decrypt, hmac} = require(cryptoPath);

// Pre-rotation scheme, rebuilt independently: AES-256-CBC with OpenSSL
// EVP_BytesToKey (MD5) key and IV.
function legacyCbcHex(password, plaintext) {
  const pwd = Buffer.from(password, 'utf8');
  const out = Buffer.alloc(48);
  let d = Buffer.alloc(0);
  let filled = 0;
  while (filled < 48) {
    d = nodeCrypto.createHash('md5').update(d).update(pwd).digest();
    d.copy(out, filled);
    filled += d.length;
  }
  const cipher = nodeCrypto.createCipheriv('aes-256-cbc', out.subarray(0, 32), out.subarray(32, 48));
  return cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
}

// Independent check that a v2: value authenticates under sha256(secret).
function authenticatesUnder(secret, value) {
  try {
    const key = nodeCrypto.createHash('sha256').update(secret, 'utf8').digest();
    const data = Buffer.from(value.slice(3), 'base64');
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return decipher.update(data.subarray(28), undefined, 'utf8') + decipher.final('utf8');
  } catch (error) {
    return undefined;
  }
}

const saved = {};
beforeEach(() => {
  ['TS_ENCRYPTION_KEY', 'TS_ENCRYPTION_KEY_LEGACY'].forEach((name) => {
    saved[name] = process.env[name];
    delete process.env[name];
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  Object.keys(saved).forEach((name) => {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  });
  jest.restoreAllMocks();
});

afterAll(() => {
  fs.unlinkSync(cryptoPath);
});

describe('no built-in key in the source', () => {
  it.each(['imports/lib/crypto.js', 'imports/lib/models/signature/index.js'])(
    '%s has no fallback literal behind TS_ENCRYPTION_KEY_LEGACY',
    (rel) => {
      expect(read(rel)).not.toMatch(/TS_ENCRYPTION_KEY_LEGACY\s*\|\|/);
    }
  );
});

describe('crypto.js legacy decrypt', () => {
  it('reads a pre-rotation credential with TS_ENCRYPTION_KEY_LEGACY, set after the module loaded', () => {
    process.env.TS_ENCRYPTION_KEY = 'current-environment-key';
    process.env.TS_ENCRYPTION_KEY_LEGACY = SPEC_LEGACY_PASSWORD;
    expect(decrypt(legacyCbcHex(SPEC_LEGACY_PASSWORD, 'jira-password'))).toBe('jira-password');
  });

  it('cannot read it without TS_ENCRYPTION_KEY_LEGACY', () => {
    process.env.TS_ENCRYPTION_KEY = 'current-environment-key';
    expect(decrypt(legacyCbcHex(SPEC_LEGACY_PASSWORD, 'jira-password'))).toBeUndefined();
  });

  it('cannot read it under a different TS_ENCRYPTION_KEY_LEGACY', () => {
    process.env.TS_ENCRYPTION_KEY = 'current-environment-key';
    process.env.TS_ENCRYPTION_KEY_LEGACY = 'some-other-password';
    expect(decrypt(legacyCbcHex(SPEC_LEGACY_PASSWORD, 'jira-password'))).not.toBe('jira-password');
  });
});

describe('crypto.js without TS_ENCRYPTION_KEY', () => {
  it('encrypts under TS_ENCRYPTION_KEY_LEGACY, so data written that way stays readable', () => {
    process.env.TS_ENCRYPTION_KEY_LEGACY = SPEC_LEGACY_PASSWORD;
    const value = encrypt('api-key-value');
    expect(authenticatesUnder(SPEC_LEGACY_PASSWORD, value)).toBe('api-key-value');
    expect(decrypt(value)).toBe('api-key-value');
  });

  it('refuses to encrypt, decrypt or hash when neither key is set', () => {
    process.env.TS_ENCRYPTION_KEY = 'a-key-that-goes-away';
    const value = encrypt('api-key-value');
    delete process.env.TS_ENCRYPTION_KEY;

    expect(encrypt('api-key-value')).toBeUndefined();
    expect(decrypt(value)).toBeUndefined();
    expect(() => hmac('api-key-value')).toThrow(/TS_ENCRYPTION_KEY/);
  });
});

describe('signature model without TS_ENCRYPTION_KEY', () => {
  const source = read('imports/lib/models/signature/index.js');
  const start = source.indexOf('function getSigningKey()');
  const body = source.slice(start, source.indexOf('\n}\n', start));

  it('falls back to TS_ENCRYPTION_KEY_LEGACY only', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/process\.env\.TS_ENCRYPTION_KEY_LEGACY/);
    expect(body).not.toMatch(/'[^']{12,}'\s*;/);
  });

  it('throws when neither key is set instead of signing with a known value', () => {
    expect(body).toMatch(/throw new Error\([^)]*TS_ENCRYPTION_KEY/);
  });
});

describe('encryption-key-guard at startup', () => {
  const guardSource = read('imports/startup/server/encryption-key-guard.js')
    .replace(/^import[\s\S]*?from\s*'[^']*';[ \t]*$/gm, '');
  const runGuard = new Function('Meteor', 'process', 'console', guardSource);

  function boot({isProduction, env}) {
    const exit = jest.fn();
    const logs = {error: jest.fn(), warn: jest.fn()};
    runGuard({isProduction, startup: (fn) => fn()}, {env, exit}, logs);
    return {exit, logs};
  }

  it('refuses to start in production when neither key is set', () => {
    const {exit, logs} = boot({isProduction: true, env: {}});
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.error).toHaveBeenCalled();
  });

  it('starts in production with only TS_ENCRYPTION_KEY_LEGACY, loudly', () => {
    const {exit, logs} = boot({isProduction: true, env: {TS_ENCRYPTION_KEY_LEGACY: 'x'}});
    expect(exit).not.toHaveBeenCalled();
    expect(logs.error).toHaveBeenCalled();
  });

  it('still honours TS_REQUIRE_ENCRYPTION_KEY=true with only the legacy key', () => {
    const {exit} = boot({isProduction: true,
      env: {TS_ENCRYPTION_KEY_LEGACY: 'x', TS_REQUIRE_ENCRYPTION_KEY: 'true'}});
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('is silent in production with TS_ENCRYPTION_KEY', () => {
    const {exit, logs} = boot({isProduction: true, env: {TS_ENCRYPTION_KEY: 'x'}});
    expect(exit).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('keeps a development server running without keys, with an error', () => {
    const {exit, logs} = boot({isProduction: false, env: {}});
    expect(exit).not.toHaveBeenCalled();
    expect(logs.error).toHaveBeenCalled();
  });
});

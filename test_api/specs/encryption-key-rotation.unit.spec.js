/* eslint-disable no-undef */
// Key rotation: after TS_ENCRYPTION_KEY changes, values written with the old key
// (now TS_ENCRYPTION_KEY_PREVIOUS) stay readable and API keys keep matching until
// TS_REENCRYPT_SECRETS rewrites them.
//
// crypto.js is loaded as runnable CommonJS with the same transform as
// encryption-legacy-key.unit.spec.js, so the real implementation is exercised.
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const cryptoPath = path.join(os.tmpdir(), `encryption-key-rotation-${process.pid}.cjs`);
fs.writeFileSync(cryptoPath, fs.readFileSync(path.join(REPO, 'imports/lib/crypto.js'), 'utf8')
  .replace("Npm.require('crypto')", "require('crypto')")
  .replace(/^export /gm, '')
  + '\nmodule.exports = {encrypt, decrypt, decryptFor, encryptFor, hmac, hmacCandidates, isEncryptedWithPreviousKey};\n');
// eslint-disable-next-line import/no-dynamic-require
const {encrypt, decrypt, decryptFor, encryptFor, hmac, hmacCandidates, isEncryptedWithPreviousKey} = require(cryptoPath);

describe('encryption key rotation', () => {
  const saved = {key: process.env.TS_ENCRYPTION_KEY, previous: process.env.TS_ENCRYPTION_KEY_PREVIOUS};
  let logSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    ['TS_ENCRYPTION_KEY', 'TS_ENCRYPTION_KEY_PREVIOUS'].forEach((name, i) => {
      const value = i === 0 ? saved.key : saved.previous;
      if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
    });
  });
  afterAll(() => fs.unlinkSync(cryptoPath));

  function writeWithOldKey(fn) {
    process.env.TS_ENCRYPTION_KEY = 'old-spec-key';
    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    const value = fn();
    process.env.TS_ENCRYPTION_KEY = 'new-spec-key';
    return value;
  }

  it('cannot read old values after a key change without the previous key', () => {
    const stored = writeWithOldKey(() => encrypt('jira-password'));
    expect(decrypt(stored)).toBeUndefined();
    expect(isEncryptedWithPreviousKey(stored)).toBe(false);
  });

  it('reads old values with TS_ENCRYPTION_KEY_PREVIOUS and marks them for re-encryption', () => {
    const stored = writeWithOldKey(() => encrypt('jira-password'));
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'old-spec-key';
    expect(decrypt(stored)).toBe('jira-password');
    expect(isEncryptedWithPreviousKey(stored)).toBe(true);
    const rewritten = encrypt(decrypt(stored));
    expect(isEncryptedWithPreviousKey(rewritten)).toBe(false);
    expect(decrypt(rewritten)).toBe('jira-password');
  });

  it('reads domain-separated values written with the previous key', () => {
    const stored = writeWithOldKey(() => encryptFor('csaf-product-id', 'module-1'));
    expect(decryptFor('csaf-product-id', stored)).toBeUndefined();
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'old-spec-key';
    expect(decryptFor('csaf-product-id', stored)).toBe('module-1');
  });

  it('matches an API key stored under its previous blind index', () => {
    const oldHash = writeWithOldKey(() => hmac('api-key-1'));
    expect(hmacCandidates('api-key-1')).toEqual([hmac('api-key-1')]);
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'old-spec-key';
    expect(hmacCandidates('api-key-1')).toEqual([hmac('api-key-1'), oldHash]);
  });
});

/* eslint-disable no-undef */
// LeanIX tokens saved before they were encrypted (1.0.0 stored leanix.token as
// typed) are encrypted on startup, the way release / CSAF feed keys
// (security/publicKeys.js) and webhooks (security/webhookSecrets.js) are, so an
// operator does not have to run TS_REENCRYPT_SECRETS for them.
//
// crypto.js is loaded as runnable CommonJS with the same transform as
// encryption-key-rotation.unit.spec.js, so the real implementation is exercised.
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const cryptoPath = path.join(os.tmpdir(), `leanix-token-sealing-${process.pid}.cjs`);
fs.writeFileSync(cryptoPath, fs.readFileSync(path.join(REPO, 'imports/lib/crypto.js'), 'utf8')
  .replace("Npm.require('crypto')", "require('crypto')")
  .replace(/^export /gm, '')
  + '\nmodule.exports = {encrypt, decryptV2Only, VERSION_PREFIX};\n');
// eslint-disable-next-line import/no-dynamic-require
const realCrypto = require(cryptoPath);
const {sealPlaintextLeanixTokens} = require('../../imports/server/security/leanixToken');

// Enough of the Companies collection: find() hands back every doc (the helper
// re-checks each token itself) and records the selector; updateAsync() applies a
// $set of leanix.token when the selector's _id and leanix.token both match.
function fakeCompanies(docs) {
  const calls = {find: [], update: []};
  return {
    docs,
    calls,
    find(selector, options) {
      calls.find.push({selector, options});
      return {fetchAsync: async () => JSON.parse(JSON.stringify(docs))};
    },
    async updateAsync(selector, modifier, options) {
      calls.update.push({selector, modifier, options});
      const doc = docs.find((d) => d._id === selector._id);
      if (!doc || !doc.leanix || doc.leanix.token !== selector['leanix.token']) {
        return 0;
      }
      doc.leanix.token = modifier.$set['leanix.token'];
      return 1;
    }
  };
}

describe('sealing plaintext LeanIX tokens on startup', () => {
  const saved = process.env.TS_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.TS_ENCRYPTION_KEY = 'leanix-sealing-spec-key';
  });
  afterEach(() => {
    if (saved === undefined) { delete process.env.TS_ENCRYPTION_KEY; } else { process.env.TS_ENCRYPTION_KEY = saved; }
  });
  afterAll(() => fs.unlinkSync(cryptoPath));

  it('encrypts a plaintext token, and leanixLogin still reads the same token', async () => {
    const Companies = fakeCompanies([{_id: 'c1', leanix: {companyName: 'acme', token: 'plain-leanix-token'}}]);
    expect(await sealPlaintextLeanixTokens(Companies, realCrypto)).toBe(1);
    const token = Companies.docs[0].leanix.token;
    expect(token.startsWith('v2:')).toBe(true);
    expect(realCrypto.decryptV2Only(token)).toBe('plain-leanix-token');
    expect(Companies.docs[0].leanix.companyName).toBe('acme');
    // Written like the other startup sealers, guarded on the value it read.
    expect(Companies.calls.update[0].selector).toEqual({_id: 'c1', 'leanix.token': 'plain-leanix-token'});
    expect(Companies.calls.update[0].options).toEqual({bypassCollection2: true});
  });

  it('is idempotent and leaves encrypted, empty and missing tokens alone', async () => {
    const sealed = realCrypto.encrypt('already-sealed');
    const Companies = fakeCompanies([
      {_id: 'c1', leanix: {token: 'plain-one'}},
      {_id: 'c2', leanix: {token: sealed}},
      {_id: 'c3', leanix: {token: ''}},
      {_id: 'c4', leanix: {companyName: 'no token'}},
      {_id: 'c5'}
    ]);
    expect(await sealPlaintextLeanixTokens(Companies, realCrypto)).toBe(1);
    const first = Companies.docs[0].leanix.token;
    expect(Companies.docs[1].leanix.token).toBe(sealed);
    expect(Companies.docs[2].leanix.token).toBe('');
    expect(Companies.calls.update.map((u) => u.selector._id)).toEqual(['c1']);

    expect(await sealPlaintextLeanixTokens(Companies, realCrypto)).toBe(0);
    expect(Companies.docs[0].leanix.token).toBe(first);
    expect(Companies.calls.update).toHaveLength(1);
  });

  it('asks the database only for tokens without the v2: prefix', async () => {
    const Companies = fakeCompanies([]);
    await sealPlaintextLeanixTokens(Companies, realCrypto);
    const {selector, options} = Companies.calls.find[0];
    expect(selector['leanix.token'].$type).toBe('string');
    expect(selector['leanix.token'].$not.test('v2:abc')).toBe(true);
    expect(selector['leanix.token'].$not.test('plain')).toBe(false);
    expect(options.fields).toEqual({'leanix.token': 1});
  });

  it('never overwrites a token when encryption does not produce a v2: value', async () => {
    const Companies = fakeCompanies([{_id: 'c1', leanix: {token: 'plain-leanix-token'}}]);
    // encrypt() returns undefined when TS_ENCRYPTION_KEY cannot be used.
    const brokenCrypto = Object.assign({}, realCrypto, {encrypt: () => undefined});
    await expect(sealPlaintextLeanixTokens(Companies, brokenCrypto)).rejects.toThrow(/TS_ENCRYPTION_KEY/);
    expect(Companies.docs[0].leanix.token).toBe('plain-leanix-token');
    expect(Companies.calls.update).toHaveLength(0);
  });

  it('runs on server startup from the LeanIX startup file', () => {
    const src = fs.readFileSync(path.join(REPO, 'imports/startup/server/leanix.js'), 'utf8');
    expect(src).toMatch(/require\('\/imports\/server\/security\/leanixToken'\)/);
    expect(src).toMatch(/Meteor\.startup\(async function \(\) \{[\s\S]*?process\.env\.TS_ENCRYPTION_KEY && !process\.env\.TS_ENCRYPTION_KEY_LEGACY[\s\S]*?await sealPlaintextLeanixTokens\(Companies, \{encrypt, VERSION_PREFIX\}\)/);
    const index = fs.readFileSync(path.join(REPO, 'imports/startup/server/index.js'), 'utf8');
    expect(index).toMatch(/import '\.\/leanix';/);
  });
});

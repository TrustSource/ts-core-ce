/* eslint-disable no-undef */
// Key rotation and webhooks: TS_REENCRYPT_SECRETS rewrites a webhook's url, header
// values and signing secret written with TS_ENCRYPTION_KEY_PREVIOUS, so they stay
// readable once the previous key is removed.
//
// reencrypt-secrets.js imports meteor/* and cannot be `require`d under Jest. This
// spec lifts the real source, strips only its import lines and the
// Meteor.startup hook, and runs runReencryption() with in-memory collections and
// the real crypto.js (loaded as in encryption-key-rotation.unit.spec.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const cryptoPath = path.join(os.tmpdir(), `reencrypt-webhook-crypto-${process.pid}.cjs`);
fs.writeFileSync(cryptoPath, fs.readFileSync(path.join(REPO, 'imports/lib/crypto.js'), 'utf8')
  .replace("Npm.require('crypto')", "require('crypto')")
  .replace(/^export /gm, '')
  + '\nmodule.exports = {encrypt, decrypt, decryptV2Only, hmac, isEncryptedWithPreviousKey};\n');
// eslint-disable-next-line import/no-dynamic-require
const realCrypto = require(cryptoPath);
const {encrypt, decryptV2Only} = realCrypto;

const RE_ANCHOR = 'imports/startup/server/reencrypt-secrets.js no longer has the shape this spec lifts ' +
  '(ES imports, `export async function runReencryption`, a Meteor.startup hook). Re-anchor the lift.';

function getPath(doc, key) {
  return key.split('.').reduce((o, k) => (o ? o[k] : undefined), doc);
}

// Enough of a Mongo collection for runReencryption: find().fetchAsync() returns
// every doc (the passes filter values themselves) and updateAsync() applies a
// $set when every selector field matches, with `a.$.b` resolved against the
// array element the `a.b` selector matched.
function fakeCollection(docs) {
  const updates = [];
  return {
    docs,
    updates,
    find: () => ({fetchAsync: async () => JSON.parse(JSON.stringify(docs))}),
    updateAsync: async (selector, modifier) => {
      updates.push({selector, modifier});
      const sel = typeof selector === 'string' ? {_id: selector} : selector;
      const doc = docs.find((d) => d._id === sel._id);
      if (!doc) { return 0; }
      let positional = null;
      for (const [key, want] of Object.entries(sel)) {
        if (key === '_id') { continue; }
        const [arrayKey, field] = key.split('.');
        if (field && Array.isArray(doc[arrayKey])) {
          const index = doc[arrayKey].findIndex((el) => el && el[field] === want);
          if (index < 0) { return 0; }
          positional = index;
        } else if (getPath(doc, key) !== want) {
          return 0;
        }
      }
      for (const [key, value] of Object.entries(modifier.$set)) {
        const parts = key.split('.').map((p) => (p === '$' ? positional : p));
        let target = doc;
        parts.slice(0, -1).forEach((p) => { target = target[p] = target[p] || {}; });
        target[parts[parts.length - 1]] = value;
      }
      return 1;
    }
  };
}

function loadRunReencryption(collections) {
  const source = fs.readFileSync(path.join(REPO, 'imports/startup/server/reencrypt-secrets.js'), 'utf8');
  const body = source
    .split('\n').map((line) => (/^\s*\/\//.test(line) ? '' : line)).join('\n')
    .replace(/^import[\s\S]*?from\s+'[^']*';[ \t]*$/gm, '')
    .replace(/^Meteor\.startup\([\s\S]*?^\}\);[ \t]*$/m, '')
    .replace(/^export\s+(async\s+function|function|const)\s/gm, '$1 ');
  if (/\bfrom\s+'[^']*'/.test(body) || /\bexport\b/.test(body) || /Meteor\.startup/.test(body) ||
    !/async function runReencryption/.test(body)) {
    throw new Error(RE_ANCHOR);
  }
  // eslint-disable-next-line no-new-func
  const factory = new Function('Companies', 'Projects', 'Webhooks', 'encrypt', 'decrypt', 'hmac',
    'isEncryptedWithPreviousKey', 'needsApiKeyUpgrade', 'upgradeApiKeyEntry', 'PUBLIC_KEY_FIELDS',
    `${body}\nreturn runReencryption;`);
  return factory(collections.Companies, collections.Projects, collections.Webhooks,
    realCrypto.encrypt, realCrypto.decrypt, realCrypto.hmac, realCrypto.isEncryptedWithPreviousKey,
    () => false, async () => {}, []);
}

describe('reencrypt-secrets: webhooks under the previous key', () => {
  const saved = {key: process.env.TS_ENCRYPTION_KEY, previous: process.env.TS_ENCRYPTION_KEY_PREVIOUS};
  let logSpy;
  let webhooks;
  let runReencryption;

  const URL = 'https://hooks.slack.example/services/T000/B000/secret-token';

  function withOldKey(fn) {
    process.env.TS_ENCRYPTION_KEY = 'webhook-old-key';
    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    const value = fn();
    process.env.TS_ENCRYPTION_KEY = 'webhook-new-key';
    process.env.TS_ENCRYPTION_KEY_PREVIOUS = 'webhook-old-key';
    return value;
  }

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const old = withOldKey(() => ({
      url: encrypt(URL),
      auth: encrypt('Bearer header-token'),
      secret: encrypt('signing-secret-1')
    }));
    const current = {url: encrypt('https://current.example/hook'), secret: encrypt('signing-secret-2'),
      header: encrypt('current-header')};
    webhooks = fakeCollection([
      {_id: 'wh-old', url: old.url, urlDisplay: 'https://hooks.slack.example/…', secret: old.secret,
        headers: [{key: 'Authorization', value: old.auth}, {key: 'X-Empty', value: ''}]},
      {_id: 'wh-current', url: current.url, secret: current.secret,
        headers: [{key: 'X-Token', value: current.header}]}
    ]);
    runReencryption = loadRunReencryption({
      Companies: fakeCollection([]), Projects: fakeCollection([]), Webhooks: webhooks
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    ['TS_ENCRYPTION_KEY', 'TS_ENCRYPTION_KEY_PREVIOUS'].forEach((name, i) => {
      const value = i === 0 ? saved.key : saved.previous;
      if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
    });
  });
  afterAll(() => fs.unlinkSync(cryptoPath));

  it('dry run counts the previous-key values and writes nothing', async () => {
    const before = JSON.parse(JSON.stringify(webhooks.docs));
    const result = await runReencryption('dry');
    expect(result.webhooks).toEqual({migrated: 3, skipped: 3, failed: 0});
    expect(webhooks.updates).toHaveLength(0);
    expect(webhooks.docs).toEqual(before);
  });

  it('rewrites url, header values and secret so they read without the previous key', async () => {
    const result = await runReencryption('true');
    expect(result.webhooks).toEqual({migrated: 3, skipped: 3, failed: 0});

    delete process.env.TS_ENCRYPTION_KEY_PREVIOUS;
    const row = webhooks.docs.find((d) => d._id === 'wh-old');
    expect(row.url.startsWith('v2:')).toBe(true);
    expect(decryptV2Only(row.url)).toBe(URL);
    expect(decryptV2Only(row.headers[0].value)).toBe('Bearer header-token');
    expect(row.headers[0].key).toBe('Authorization');
    expect(row.headers[1]).toEqual({key: 'X-Empty', value: ''});
    expect(decryptV2Only(row.secret)).toBe('signing-secret-1');
    expect(row.urlDisplay).toBe('https://hooks.slack.example/…');
  });

  it('leaves values under the current key byte-identical, and a second run migrates nothing', async () => {
    const current = JSON.parse(JSON.stringify(webhooks.docs.find((d) => d._id === 'wh-current')));
    await runReencryption('true');
    expect(webhooks.docs.find((d) => d._id === 'wh-current')).toEqual(current);
    expect(webhooks.updates.every((u) => u.selector._id === 'wh-old')).toBe(true);

    const again = await runReencryption('true');
    expect(again.webhooks).toEqual({migrated: 0, skipped: 6, failed: 0});
  });
});

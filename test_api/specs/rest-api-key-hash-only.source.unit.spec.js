/* eslint-disable no-undef */
// REST API keys authenticate by their HMAC hash only.
//
// The lookup used to fall back to `apiKeys.key === <presented value>` when no hash matched.
// `key` holds the v2: ciphertext of every key the app creates, so that fallback turned the
// stored ciphertext itself into a working credential, and it kept accepting legacy
// plaintext values with no hash at all. Legacy plaintext entries are upgraded (hash +
// ciphertext) by the opt-in bulk migration (TS_REENCRYPT_SECRETS) or the first time an
// account admin opens the API keys page; until then they do not authenticate.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

function functionBody(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) {
    throw new Error(`${signature} not found`);
  }
  return src.slice(start, src.indexOf('\n}\n', start));
}

describe('RestApi.getKeyMetaAndCompanyByAccountAndApiKey', () => {
  const body = functionBody(stripComments(read('imports/server/rest-api/RestApi.js')),
    'async function getKeyMetaAndCompanyByAccountAndApiKey(apiKey)');

  it('looks the key up by its hash among published keys', () => {
    // hmacCandidates: the current hash, plus the previous one during a key rotation.
    expect(body).toMatch(/const keyHashes = hmacCandidates\(apiKey\);/);
    expect(body).toMatch(/\{'apiKeys': \{ \$elemMatch: \{ keyHash: \{\$in: keyHashes\}, published: true \} \}\}/);
  });

  it('has no lookup by the stored key value', () => {
    expect(body).not.toMatch(/key: apiKey/);
    expect(body).not.toMatch(/\.key === apiKey/);
    expect(body).not.toMatch(/'apiKeys\.key'/);
  });

  it('picks the matched key entry by hash only', () => {
    expect(body).toMatch(/return keyHashes\.indexOf\(key\.keyHash\) > -1 && key\.published === true;/);
  });

  it('still refuses a non-string key before any lookup', () => {
    expect(body.indexOf('typeof apiKey === \'string\'')).toBeGreaterThan(-1);
    expect(body.indexOf('typeof apiKey === \'string\'')).toBeLessThan(body.indexOf('Companies.findOneAsync'));
  });
});

describe('keys created by the app carry the hash the lookup needs', () => {
  const companies = stripComments(read('imports/server/collections/companies.js'));

  it('every apiKeys entry the app creates stores keyHash next to the encrypted key', () => {
    const creates = companies.match(/keyHash: hmac\(plainKey\)/g) || [];
    // apiKey.create and createApiKeyByUser.
    expect(creates.length).toBeGreaterThanOrEqual(2);
  });

  it('legacy plaintext entries are upgraded with a hash (bulk migration and on read)', () => {
    const upgrade = stripComments(read('imports/server/security/apiKeyUpgrade.js'));
    expect(upgrade).toMatch(/keyHash: hmac\(plain\)/);
  });
});

// A company's LeanIX API token (leanix.token) is stored encrypted with
// TS_ENCRYPTION_KEY (companies/updateLeanix.js) and decrypted only on the server
// (startup/server/leanix.js). A token saved before that is still plaintext; it is
// encrypted on startup, like the release / CSAF feed keys (publicKeys.js) and
// webhooks (webhookSecrets.js). Only plaintext is rewritten: a `v2:` value,
// current or under TS_ENCRYPTION_KEY_PREVIOUS, is left to TS_REENCRYPT_SECRETS.
//
// CommonJS with the collection and crypto passed in, so the jest harness can run
// it without Meteor.

const LEANIX_TOKEN = 'leanix.token';

/**
 * Encrypts every LeanIX token stored in plaintext.
 *
 * @param {Object} Companies the Companies collection
 * @param {{encrypt: Function, VERSION_PREFIX: String}} crypto from /imports/lib/crypto
 * @returns {Promise<Number>} how many tokens were encrypted
 */
async function sealPlaintextLeanixTokens(Companies, crypto) {
  const prefix = crypto.VERSION_PREFIX;
  const isPlaintext = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith(prefix);
  const companies = await Companies.find(
    {[LEANIX_TOKEN]: {$type: 'string', $not: new RegExp('^' + prefix)}},
    {fields: {[LEANIX_TOKEN]: 1}, transform: null}
  ).fetchAsync();
  let sealed = 0;
  for (const company of companies) {
    const token = company.leanix && company.leanix.token;
    if (!isPlaintext(token)) {
      continue;
    }
    // encrypt() returns undefined instead of throwing when it cannot encrypt;
    // the plaintext is never replaced by that.
    const encrypted = crypto.encrypt(token);
    if (typeof encrypted !== 'string' || !encrypted.startsWith(prefix)) {
      throw new Error('The LeanIX token could not be encrypted - is TS_ENCRYPTION_KEY set?');
    }
    // Matched on the value read, so a token saved meanwhile is not overwritten.
    sealed += await Companies.updateAsync({_id: company._id, [LEANIX_TOKEN]: token},
      {$set: {[LEANIX_TOKEN]: encrypted}}, {bypassCollection2: true});
  }
  return sealed;
}

module.exports = {sealPlaintextLeanixTokens};

import {Meteor} from 'meteor/meteor';
import uuid from 'uuid';
import _ from 'underscore';
import Companies from '/imports/lib/collections/companies';
import {encrypt, decrypt, hmac, hmacCandidates, maskKey, VERSION_PREFIX} from '/imports/lib/crypto';

// Release keys (publicReleaseKeys) and CSAF feed keys (publicCsafKeys) are bearer
// credentials for the public feeds. They are stored like API keys: `key` encrypted
// with TS_ENCRYPTION_KEY, `keyHash` (HMAC) to find a presented key, `maskedKey` to
// show, and a non-secret `id` the pages manage them by. The plaintext only leaves
// the server through the role-checked reveal methods (copy, QR code).

export const PUBLIC_KEY_FIELDS = ['publicReleaseKeys', 'publicCsafKeys'];

function sealPlainKey(plain) {
  const key = encrypt(plain);
  if (typeof key !== 'string' || !key.startsWith(VERSION_PREFIX)) {
    throw new Meteor.Error(500, 'The key could not be encrypted - is TS_ENCRYPTION_KEY set?');
  }
  return {key, keyHash: hmac(plain), maskedKey: maskKey(plain)};
}

/**
 * A new key entry with a fresh secret.
 *
 * @param {Object} fields the entry's other fields (name, releaseId, tlpLevels, ...)
 */
export function newPublicKeyEntry(fields) {
  return Object.assign({id: uuid.v4()}, fields, sealPlainKey(uuid.v4()));
}

// The blind indexes a presented key may be stored under (two during a key rotation).
export function presentedKeyHashes(presented) {
  return typeof presented === 'string' && presented ? hmacCandidates(presented) : [];
}

export function withoutSecret(entry) {
  return entry ? _.omit(entry, 'key', 'keyHash') : entry;
}

/**
 * The plaintext of a stored entry, for the reveal methods.
 */
export function revealPublicKey(entry) {
  const plain = entry && decrypt(entry.key);
  if (typeof plain !== 'string' || !plain) {
    throw new Meteor.Error(500, 'The key could not be decrypted with the current TS_ENCRYPTION_KEY');
  }
  return plain;
}

function needsUpgrade(entry) {
  return !!entry && typeof entry.key === 'string' && entry.key.length > 0 && !entry.key.startsWith(VERSION_PREFIX);
}

function upgradeEntry(entry) {
  return Object.assign({}, entry, {id: entry.id || uuid.v4()}, sealPlainKey(entry.key));
}

/**
 * Encrypts every key stored in plaintext (written before keys were encrypted).
 * The plaintext stays valid: it is what the holders of the key present.
 *
 * @returns {Promise<Number>} how many keys were upgraded
 */
export async function upgradePublicKeys() {
  let upgraded = 0;
  for (const field of PUBLIC_KEY_FIELDS) {
    const companies = await Companies.find({[field]: {$elemMatch: {key: {$exists: true, $not: /^v2:/}}}},
      {fields: {[field]: 1}, transform: null}).fetchAsync();
    for (const company of companies) {
      const entries = company[field] || [];
      const count = entries.filter(needsUpgrade).length;
      await Companies.updateAsync({_id: company._id},
        {$set: {[field]: entries.map((entry) => needsUpgrade(entry) ? upgradeEntry(entry) : entry)}},
        {bypassCollection2: true});
      upgraded += count;
    }
  }
  return upgraded;
}

Meteor.startup(async function () {
  if (!process.env.TS_ENCRYPTION_KEY && !process.env.TS_ENCRYPTION_KEY_LEGACY) {
    return;
  }
  try {
    const upgraded = await upgradePublicKeys();
    if (upgraded) {
      console.log(`=> Encrypted ${upgraded} release and CSAF feed keys stored in plaintext`);
    }
  } catch (error) {
    console.log('=> Release and CSAF feed keys could not be encrypted:', error && error.message);
  }
  const raw = Companies.rawCollection();
  raw.createIndex({'publicReleaseKeys.keyHash': 1}).catch(() => {});
  raw.createIndex({'publicCsafKeys.keyHash': 1}).catch(() => {});
});

import Companies from '/imports/lib/collections/companies';
import {encrypt, hmac, maskKey} from '/imports/lib/crypto';
import uuid from 'uuid';

// ---------------------------------------------------------------------------
// Shared single-entry upgrade logic for a legacy
// Companies.apiKeys[] entry - genuinely plaintext `key`, no id/keyHash/
// maskedKey. Two consumers:
//   - The opt-in BULK migration (imports/startup/server/reencrypt-secrets.js,
//     gated on TS_REENCRYPT_SECRETS) - proactively upgrades every key across
//     every company in one pass, including keys nobody has viewed yet, and
//     moves them onto the faster keyHash-indexed REST-auth lookup immediately.
//   - The SELF-HEALING on-demand upgrade (companyFull publication,
//     getApiKeysByUser, apiKey.reveal - all in
//     imports/server/collections/companies.js) - upgrades a legacy entry the
//     moment it's read/revealed, so the masked-view column and the
//     copy-to-clipboard flow work correctly for every existing key without
//     requiring an operator to run the bulk migration first.
// Both paths share this ONE implementation of "what an upgrade means" so
// they can never silently drift apart.
// ---------------------------------------------------------------------------

// True when an apiKeys[] entry still needs the encryption upgrade: a
// genuinely plaintext (non-`v2:`) key. An entry whose key is already `v2:` is
// always fully migrated - every write path that ever sets `key` to a `v2:`
// value (apiKey.create, createApiKeyByUser, apiKey.update/
// updateApiKeyByUser's force-preserve, the bulk migration, and
// upgradeApiKeyEntry below) sets keyHash/maskedKey/id together with it,
// atomically, so a `v2:` key without the other three fields cannot arise from
// any real write path.
export function needsApiKeyUpgrade(entry) {
  return !!entry && typeof entry.key === 'string' && entry.key.length > 0 && !entry.key.startsWith('v2:');
}

// Upgrades ONE apiKeys[] entry in place if needed, via a guarded (race-safe)
// per-field positional write - `{_id, 'apiKeys.key': <the value just read>}`
// matches exactly the one array element whose key still equals what was just
// read, so a concurrent create/update of a DIFFERENT key (or unrelated
// company fields) is never touched. `key` is immutable post-creation
// (apiKey.update/updateApiKeyByUser force-preserve it from the stored item),
// so the only way this guard can miss its target is if the entry was
// deleted/replaced in the interim - in which case the write is a safe no-op
// and a later read will retry the upgrade.
//
// Returns the entry as it now stands: the SAME object reference, untouched,
// if no upgrade was needed (cheap no-op - true for the overwhelming majority
// of calls once an entry has been migrated once, whether by this function or
// the bulk migration).
export async function upgradeApiKeyEntry(companyId, entry) {
  if (!needsApiKeyUpgrade(entry)) {
    return entry;
  }
  const plain = entry.key;               // genuinely plaintext, no decrypt-first
  const fields = {
    key: encrypt(plain),
    keyHash: hmac(plain),
    maskedKey: maskKey(plain),
    id: entry.id || uuid.v4()
  };
  await Companies.updateAsync(
    {_id: companyId, 'apiKeys.key': plain},
    {$set: {
      'apiKeys.$.key': fields.key,
      'apiKeys.$.keyHash': fields.keyHash,
      'apiKeys.$.maskedKey': fields.maskedKey,
      'apiKeys.$.id': fields.id
    }});
  return Object.assign({}, entry, fields);
}

// Upgrades every entry in `apiKeys` that needs it (sequentially - these are
// rare, one-time-per-entry writes, not a hot path) and returns the resulting
// array. Returns the SAME array reference, untouched, if nothing needed
// upgrading (cheap no-op - true for almost every call after a company's keys
// have all been touched once).
export async function upgradeApiKeysIfNeeded(companyId, apiKeys) {
  if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
    return apiKeys;
  }
  if (!apiKeys.some(needsApiKeyUpgrade)) {
    return apiKeys;
  }
  const upgraded = [];
  for (const entry of apiKeys) {
    upgraded.push(await upgradeApiKeyEntry(companyId, entry));
  }
  return upgraded;
}

import {Meteor} from 'meteor/meteor';
import Companies from '/imports/lib/collections/companies';
import Projects from '/imports/lib/collections/projects';
import Webhooks from '/imports/lib/collections/webhooks';
import {encrypt, decrypt, hmac, isEncryptedWithPreviousKey} from '/imports/lib/crypto';
import {needsApiKeyUpgrade, upgradeApiKeyEntry} from '/imports/server/security/apiKeyUpgrade';
import {PUBLIC_KEY_FIELDS} from '/imports/server/security/publicKeys';

// ---------------------------------------------------------------------------
// Opt-in re-encryption of stored integration credentials from the legacy
// (weak: static key + static IV, unauthenticated) scheme to the current `v2:`
// scheme (AES-256-GCM, key from TS_ENCRYPTION_KEY, random IV per record).
//
// This same opt-in flow also covers to a field that was NEVER under the
// legacy scheme at all - Companies.apiKeys[].key (REST API keys). Unlike
// jira.passwd/tfs.token/etc, a non-`v2:` value here is genuinely plaintext, not
// legacy ciphertext - so it is migrated with a decrypt-free upgrade path
// (encrypt() directly, never decrypt()-first; reusing reencryptCollection's
// legacy-decrypt assumption on a raw UUID string would throw/produce garbage).
// It also backfills keyHash (HMAC blind index), `id` and `maskedKey` - ONLY
// alongside that same entry's plaintext->v2 transition, never independently, so
// an already-`v2:` entry is left byte-identical (not partially touched) and the
// migrated/skipped counters stay meaningful.
//
// Runs only when TS_REENCRYPT_SECRETS is set, AND TS_ENCRYPTION_KEY is set
// (otherwise it would just re-encrypt with the weak fallback key). Idempotent:
// values already prefixed `v2:` are skipped, so re-running is safe.
//
// Operator workflow:
//   1. Provision TS_ENCRYPTION_KEY (a strong random secret).
//   2. Deploy with TS_REENCRYPT_SECRETS=dry   -> logs counts, writes nothing.
//   3. Deploy with TS_REENCRYPT_SECRETS=true  -> performs the migration.
//   4. Remove TS_REENCRYPT_SECRETS.
//
// Key rotation uses the same run: move the old TS_ENCRYPTION_KEY to
// TS_ENCRYPTION_KEY_PREVIOUS, set a new TS_ENCRYPTION_KEY and run steps 2-4.
// Values that only the previous key can read are rewritten with the new one
// (webhook urls, header values and signing secrets included), and API keys get
// their blind index re-made. Keep TS_ENCRYPTION_KEY_PREVIOUS while
// release signatures and published CSAF product ids made with it must verify.
// Once every value is `v2:`, the legacy block in imports/lib/crypto.js (and the
// hard-coded legacy password) can be removed.
// ---------------------------------------------------------------------------

const SECRET_PATHS = {
  Companies: ['jira.passwd', 'tfs.token', 'github.token', 'scanoss.token'],
  Projects: ['jira.passwd', 'tfs.token', 'github.token']
};

// Fields that were stored in plaintext before they were encrypted: a value
// without the `v2:` prefix is the secret itself, not legacy ciphertext.
const PLAINTEXT_SECRET_PATHS = {
  Companies: ['leanix.token']
};

function getNested(doc, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), doc);
}

async function reencryptCollection(collection, paths, label, dryRun, plaintext) {
  let migrated = 0, skipped = 0, failed = 0;
  const selector = {$or: paths.map(p => ({[p]: {$exists: true, $ne: null}}))};
  const docs = await collection.find(selector).fetchAsync();
  for (const doc of docs) {
    const setOps = {};
    for (const path of paths) {
      const val = getNested(doc, path);
      if (typeof val !== 'string' || val.length === 0) {
        continue;
      }
      if (val.startsWith('v2:') && !isEncryptedWithPreviousKey(val)) {
        skipped++;
        continue;
      }
      try {
        // legacy, or v2 under the previous key; a former plaintext field as it is
        const plain = (plaintext && !val.startsWith('v2:')) ? val : decrypt(val);
        if (typeof plain !== 'string') { failed++; continue; }
        setOps[path] = encrypt(plain);          // re-encrypt as v2
        migrated++;
      } catch (e) {
        failed++;
        console.log(`[reencrypt] ${label} ${doc._id} ${path} failed:`, e.message);
      }
    }
    if (!dryRun && Object.keys(setOps).length) {
      await collection.updateAsync(doc._id, {$set: setOps});
    }
  }
  console.log(`[reencrypt] ${label}: ${dryRun ? 'WOULD migrate' : 'migrated'}=${migrated} ` +
    `skipped(v2)=${skipped} failed=${failed}`);
  return {migrated, skipped, failed};
}

// Companies.apiKeys is an ARRAY of objects (unlike the dotted-scalar paths
// above) - dedicated per-entry iteration. Decrypt-free: a non-`v2:` key is
// genuinely plaintext (these fields never had a legacy-encrypted form). The
// actual per-entry upgrade (encrypt + keyHash/maskedKey/id backfill, written
// via a guarded/race-safe positional update) is the SAME shared
// upgradeApiKeyEntry() used by the self-healing on-demand call sites
// (companyFull/getApiKeysByUser/apiKey.reveal in companies.js) - one
// implementation, not two. This function only adds the dry-run/count wrapper
// around it (the shared helper always writes when an upgrade is needed, so a
// dry run must count without calling it).
async function reencryptApiKeysArray(dryRun) {
  let migrated = 0, skipped = 0, failed = 0;
  const docs = await Companies.find({'apiKeys': {$exists: true, $not: {$size: 0}}},
    {fields: {apiKeys: 1}}).fetchAsync();
  for (const doc of docs) {
    for (const entry of (doc.apiKeys || [])) {
      if (typeof entry.key !== 'string' || entry.key.length === 0) {
        continue;
      }
      const rotate = isEncryptedWithPreviousKey(entry.key);
      if (!rotate && !needsApiKeyUpgrade(entry)) {
        skipped++;
        continue;             // already migrated - left byte-identical
      }
      try {
        if (!dryRun) {
          await (rotate ? rotateApiKeyEntry(doc._id, entry) : upgradeApiKeyEntry(doc._id, entry));
        }
        migrated++;
      } catch (e) {
        failed++;
        console.log(`[reencrypt] Companies ${doc._id} apiKeys[${entry.id || ''}] failed:`, e.message);
      }
    }
  }
  console.log(`[reencrypt] Companies.apiKeys: ${dryRun ? 'WOULD migrate' : 'migrated'}=${migrated} ` +
    `skipped(v2)=${skipped} failed=${failed}`);
  return {migrated, skipped, failed};
}

// Rewrites a `v2:` API key written with TS_ENCRYPTION_KEY_PREVIOUS: the key with
// the new encryption key and its blind index with the new HMAC key. Guarded on the
// value just read, like upgradeApiKeyEntry.
async function rotateApiKeyEntry(companyId, entry) {
  const plain = decrypt(entry.key);
  if (typeof plain !== 'string' || !plain) {
    throw new Error('key could not be decrypted');
  }
  const key = encrypt(plain);
  if (typeof key !== 'string' || !key.startsWith('v2:')) {
    throw new Error('key could not be encrypted');
  }
  await Companies.updateAsync(
    {_id: companyId, 'apiKeys.key': entry.key},
    {$set: {'apiKeys.$.key': key, 'apiKeys.$.keyHash': hmac(plain)}});
}

// Release and CSAF feed keys (security/publicKeys.js) written with
// TS_ENCRYPTION_KEY_PREVIOUS: re-encrypted and re-hashed with the new key.
async function rotatePublicKeyArrays(dryRun) {
  let migrated = 0, skipped = 0, failed = 0;
  for (const field of PUBLIC_KEY_FIELDS) {
    const docs = await Companies.find({[field + '.key']: {$exists: true}},
      {fields: {[field]: 1}, transform: null}).fetchAsync();
    for (const doc of docs) {
      for (const entry of (doc[field] || [])) {
        if (!isEncryptedWithPreviousKey(entry.key)) {
          skipped++;
          continue;
        }
        try {
          const plain = decrypt(entry.key);
          const key = encrypt(plain);
          if (typeof plain !== 'string' || typeof key !== 'string' || !key.startsWith('v2:')) {
            throw new Error('key could not be re-encrypted');
          }
          if (!dryRun) {
            await Companies.updateAsync({_id: doc._id, [field + '.key']: entry.key},
              {$set: {[field + '.$.key']: key, [field + '.$.keyHash']: hmac(plain)}}, {bypassCollection2: true});
          }
          migrated++;
        } catch (e) {
          failed++;
          console.log(`[reencrypt] Companies ${doc._id} ${field}[${entry.id || ''}] failed:`, e.message);
        }
      }
    }
  }
  console.log(`[reencrypt] release and CSAF feed keys: ${dryRun ? 'WOULD migrate' : 'migrated'}=${migrated} ` +
    `skipped=${skipped} failed=${failed}`);
  return {migrated, skipped, failed};
}

// A webhook's url, header values and signing secret (security/webhookSecrets.js)
// written with TS_ENCRYPTION_KEY_PREVIOUS: re-encrypted with the new key. Values
// not yet `v2:` are left to the startup sealer there. Each write is guarded on the
// value just read, like the key arrays above.
async function rotateWebhookSecrets(dryRun) {
  let migrated = 0, skipped = 0, failed = 0;
  const docs = await Webhooks.find({}, {fields: {url: 1, headers: 1, secret: 1}, transform: null}).fetchAsync();
  for (const doc of docs) {
    const targets = [];
    for (const field of ['url', 'secret']) {
      if (typeof doc[field] === 'string' && doc[field]) {
        targets.push({label: field, value: doc[field], selector: {[field]: doc[field]}, set: field});
      }
    }
    (Array.isArray(doc.headers) ? doc.headers : []).forEach(function (header) {
      if (header && typeof header.value === 'string' && header.value) {
        targets.push({label: `headers[${header.key || ''}]`, value: header.value,
          selector: {'headers.value': header.value}, set: 'headers.$.value'});
      }
    });
    for (const target of targets) {
      if (!isEncryptedWithPreviousKey(target.value)) {
        skipped++;
        continue;
      }
      try {
        const plain = decrypt(target.value);
        const value = encrypt(plain);
        if (typeof plain !== 'string' || typeof value !== 'string' || !value.startsWith('v2:')) {
          throw new Error('value could not be re-encrypted');
        }
        if (!dryRun) {
          await Webhooks.updateAsync(Object.assign({_id: doc._id}, target.selector),
            {$set: {[target.set]: value}}, {bypassCollection2: true});
        }
        migrated++;
      } catch (e) {
        failed++;
        console.log(`[reencrypt] Webhooks ${doc._id} ${target.label} failed:`, e.message);
      }
    }
  }
  console.log(`[reencrypt] Webhooks: ${dryRun ? 'WOULD migrate' : 'migrated'}=${migrated} ` +
    `skipped=${skipped} failed=${failed}`);
  return {migrated, skipped, failed};
}

// Orchestrator, extracted from Meteor.startup so it can be invoked directly
// (and its per-field results asserted on) from tests, without depending on
// server-boot timing for the TS_REENCRYPT_SECRETS env var. Returns null when
// the migration doesn't run (env unset, or TS_ENCRYPTION_KEY missing).
export async function runReencryption(mode) {
  if (!mode) {
    return null;
  }
  const dryRun = mode !== 'true';   // anything other than "true" (e.g. "dry") is a dry run
  if (!process.env.TS_ENCRYPTION_KEY) {
    console.warn('[reencrypt] TS_REENCRYPT_SECRETS is set but TS_ENCRYPTION_KEY is not - ' +
      'aborting (would re-encrypt with the weak fallback key). Set TS_ENCRYPTION_KEY first.');
    return null;
  }
  console.log(`[reencrypt] starting integration-secret re-encryption (legacy or previous key -> v2), dryRun=${dryRun}`);
  const results = {};
  try {
    results.companies = await reencryptCollection(Companies, SECRET_PATHS.Companies, 'Companies', dryRun);
    results.projects = await reencryptCollection(Projects, SECRET_PATHS.Projects, 'Projects', dryRun);
    results.companiesPlaintext = await reencryptCollection(Companies, PLAINTEXT_SECRET_PATHS.Companies,
      'Companies (plaintext)', dryRun, true);
    results.apiKeys = await reencryptApiKeysArray(dryRun);
    results.publicKeys = await rotatePublicKeyArrays(dryRun);
    results.webhooks = await rotateWebhookSecrets(dryRun);
    console.log(`[reencrypt] done${dryRun ? ' (dry run - nothing written)' : '. You may now unset TS_REENCRYPT_SECRETS.'}`);
  } catch (e) {
    console.log('[reencrypt] migration error:', e.message);
  }
  return results;
}

Meteor.startup(async function () {
  await runReencryption(process.env.TS_REENCRYPT_SECRETS);
});

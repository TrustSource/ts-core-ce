// ---------------------------------------------------------------------------
// The Meteor binding for the CSAF product_id codec: the pure core in
// ./productIdCodec.js wired to the real at-rest crypto (AES-256-GCM under
// TS_ENCRYPTION_KEY, `v2:` prefix). Server-only by construction - crypto.js uses
// Npm.require - and server-only by placement, since Meteor never bundles a
// directory named `server` into the client.
//
// DOMAIN SEPARATION. TS_ENCRYPTION_KEY also protects stored integration
// credentials (Jira/TFS/GitHub/ScanOSS), REST API keys, external API keys and
// PSIRT keys. A product_id is a different data set in every respect: its
// plaintext is a document id the caller can CHOOSE (Modules has no attached
// schema and modules/create.js inserts the client object verbatim), and its
// ciphertext is published in advisories. Encrypting it with the credential key
// would therefore have made CSAF.EncodeModuleIds a chosen-plaintext oracle for
// that key and CSAF.DecodeProductIds a decrypt oracle for anything written with
// it. encryptFor/decryptFor key this codec on an independent subkey derived from
// the same environment secret - the construction crypto.js already uses for its
// blind-index key - so neither reader can read the other's ciphertext, with no
// new required environment variable.
//
// VERSION_PREFIX is imported rather than re-declared so this file and crypto.js
// cannot drift apart on the one string that decides which scheme a token uses.
// ---------------------------------------------------------------------------
import {encryptFor, decryptFor, VERSION_PREFIX} from '/imports/lib/crypto';
import {createProductIdCodec} from './productIdCodec';

// Versioned, so a future scheme change can rotate every product_id token without
// touching any other data set encrypted under TS_ENCRYPTION_KEY.
const KEY_DOMAIN = 'csaf-product-id-v1';

const codec = createProductIdCodec({
  encrypt: (id) => encryptFor(KEY_DOMAIN, id),
  decrypt: (token) => decryptFor(KEY_DOMAIN, token),
  versionPrefix: VERSION_PREFIX
});

export const encodeProductId = codec.encodeProductId;
export const decodeProductId = codec.decodeProductId;

// ids -> {[id]: token}. Used by the server generator (publicVexKey.getFile) and
// by the CSAF.EncodeModuleIds method, so the in-process and DDP paths cannot
// produce different shapes. Implemented inside the codec so its behaviour is
// covered by the Jest suite rather than only asserted on.
export const encodeIdMap = codec.encodeIdMap;

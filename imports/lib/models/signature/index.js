import {Meteor} from 'meteor/meteor';
import crypto from 'crypto';
import uuid from 'uuid';

// ---------------------------------------------------------------------------
// Integrity attestation for exported compliance artifacts (SBOM / Notice / VEX
// release files). Server-only - the signing key must never reach a client, so
// both signing (`get`) and verification (`verify`) run on the server.
//
// Current scheme: keyed HMAC-SHA256 over JSON.stringify(data). Because the key
// (derived from TS_ENCRYPTION_KEY, same secret as imports/lib/crypto.js) never
// leaves the server, a valid HMAC proves TrustSource produced the content -
// it cannot be forged by a third party. Older unkeyed MD5 signatures are not
// accepted: anyone can compute them.
// ---------------------------------------------------------------------------

const HMAC_ALGORITHM = 'hmac-sha256';

const Signature = {
  get: get,
  verify: verify
};

export default Signature;

let warnedMissingKey = false;

// Derive a 32-byte HMAC key from TS_ENCRYPTION_KEY (mirrors imports/lib/crypto.js
// key derivation). Without it, falls back to TS_ENCRYPTION_KEY_LEGACY, which an
// environment that ran without a key signed under; with neither, refuses to sign
// or verify rather than use a value anyone could know.
function getSigningKey() {
  let secret = process.env.TS_ENCRYPTION_KEY;
  if (!secret) {
    secret = process.env.TS_ENCRYPTION_KEY_LEGACY;
    if (!secret) {
      throw new Error('TS_ENCRYPTION_KEY is not set (and no TS_ENCRYPTION_KEY_LEGACY to fall back to)');
    }
    if (!warnedMissingKey) {
      console.warn('[signature] TS_ENCRYPTION_KEY is not set - release/SBOM signatures use ' +
        'TS_ENCRYPTION_KEY_LEGACY, the pre-rotation password. Set TS_ENCRYPTION_KEY to a ' +
        'strong random secret in every non-development environment.');
      warnedMissingKey = true;
    }
  }
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function hmacHex(message, key) {
  return crypto.createHmac('sha256', key || getSigningKey()).update(message, 'utf8').digest('hex');
}

// After a key rotation, files signed before it carry an HMAC made with
// TS_ENCRYPTION_KEY_PREVIOUS; they still verify while that variable is set.
function previousSigningKey() {
  const secret = process.env.TS_ENCRYPTION_KEY_PREVIOUS;
  return secret ? crypto.createHash('sha256').update(String(secret), 'utf8').digest() : null;
}

// Constant-time comparison of two hex digests (avoids a timing side-channel).
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

async function get(data) {
  return {
    'now': new Date(),
    'name': 'TrustSource',
    'id': uuid.v4(),
    'signature': {
      'algorithm': HMAC_ALGORITHM,
      'value': hmacHex(JSON.stringify(data))
    }
  };
}

async function verify(body) {
  try {
    if (!body || !Array.isArray(body.signatures) || body.signatures.length === 0) {
      return {
        status: 404,
        message: 'Data or signatures are not found'
      };
    }

    const hmacSig = body.signatures.find(
      (item) => item && item.signature && item.signature.algorithm === HMAC_ALGORITHM
    );
    const inputSignature = hmacSig && hmacSig.signature && hmacSig.signature.value;
    if (!inputSignature) {
      return {
        status: 404,
        message: 'Data or signatures are not found'
      };
    }

    delete body.signatures;
    const message = JSON.stringify(body);

    // A valid HMAC can only be produced with the server-held key, so it
    // authenticates the content regardless of the store lookup.
    let expected = hmacHex(message);
    const previousKey = previousSigningKey();
    if (!timingSafeEqualHex(inputSignature, expected) && previousKey) {
      expected = hmacHex(message, previousKey);
    }
    if (!timingSafeEqualHex(inputSignature, expected)) {
      return {
        status: 400,
        message: 'File modified or signature is invalid'
      };
    }
    const storeOne = await Meteor.callAsync('Signatures.findOne', expected);
    return {
      status: 200,
      message: storeOne ? 'Verified and found in server' : 'Verified but not found in server'
    };
  } catch (e) {
    return {
      status: 400,
      message: e && e.toString()
    };
  }
}

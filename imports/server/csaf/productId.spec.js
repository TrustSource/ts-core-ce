import {expect} from 'chai';
import {VERSION_PREFIX, encrypt, decrypt} from '/imports/lib/crypto';
import {encodeProductId, decodeProductId, encodeIdMap} from './productId';

// The ONLY layer that proves the binding is wired to the REAL cipher.
//
// test_api/specs/csaf-product-id.unit.spec.js covers the codec's behaviour under
// Jest against an injected AES-256-GCM pair, because imports/lib/crypto.js uses
// Npm.require and cannot be loaded outside a Meteor process. That leaves exactly
// one thing unproven there: that ./productId.js really passes crypto.js's
// encryptFor/decryptFor/VERSION_PREFIX in, rather than something that merely
// looks right. This runs under `yarn meteor-test`, where crypto.js is real.
//
// TS_ENCRYPTION_KEY is set per test (the apiKeyUpgrade.spec.js pattern) so the
// round trip does not depend on the ambient environment, and so an unset key does
// not silently exercise crypto.js's weak built-in fallback.
describe('CSAF productId binding: the real crypto.js cipher', function () {
  const MODULE_ID = 'abc123def456ghi7';

  beforeEach(function () {
    process.env.TS_ENCRYPTION_KEY = 'csaf-product-id-spec-test-key';
  });

  afterEach(function () {
    delete process.env.TS_ENCRYPTION_KEY;
  });

  it('encodes with the current scheme and decodes back to the original id', function () {
    const token = encodeProductId(MODULE_ID);
    expect(token.startsWith(VERSION_PREFIX)).to.equal(true);
    expect(decodeProductId(token)).to.equal(MODULE_ID);
  });

  it('uses a fresh IV, so the same id never yields the same token twice', function () {
    const first = encodeProductId(MODULE_ID);
    const second = encodeProductId(MODULE_ID);
    expect(first).to.not.equal(second);
    expect(decodeProductId(first)).to.equal(MODULE_ID);
    expect(decodeProductId(second)).to.equal(MODULE_ID);
  });

  it('returns undefined for an undecodable token instead of a garbage id', function () {
    expect(decodeProductId('hello')).to.equal(undefined);
    expect(decodeProductId('v2:not-base64!!!')).to.equal(undefined);
    expect(decodeProductId(undefined)).to.equal(undefined);
    expect(decodeProductId('')).to.equal(undefined);
  });

  it('a token minted under one encryption key does not decode under another', function () {
    const token = encodeProductId(MODULE_ID);
    process.env.TS_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(decodeProductId(token)).to.equal(undefined);
  });

  it('is domain-separated from the stored-credential ciphertexts', function () {
    // TS_ENCRYPTION_KEY also protects Jira/TFS/GitHub credentials and API keys.
    // Neither reader may read the other's ciphertext, or CSAF.EncodeModuleIds
    // becomes a chosen-plaintext oracle for the credential key.
    const token = encodeProductId(MODULE_ID);
    expect(decrypt(token)).to.equal(undefined);
    const credential = encrypt('a-stored-credential');
    expect(decrypt(credential)).to.equal('a-stored-credential');   // non-vacuity
    expect(decodeProductId(credential)).to.equal(undefined);
  });

  it('encodeIdMap returns one decodable token per id', function () {
    const map = encodeIdMap(['m1', 'm2', 'm2']);
    expect(Object.keys(map).sort()).to.deep.equal(['m1', 'm2']);
    expect(decodeProductId(map.m1)).to.equal('m1');
    expect(decodeProductId(map.m2)).to.equal('m2');
  });

  it('encodeIdMap on an empty or missing list is an empty map', function () {
    expect(encodeIdMap([])).to.deep.equal({});
    expect(encodeIdMap(undefined)).to.deep.equal({});
  });

  it('encodeIdMap refuses an unusable id rather than emitting a hole in the map', function () {
    expect(() => encodeIdMap(['m1', ''])).to.throw('CSAF productId: id must be a non-empty string');
  });
});

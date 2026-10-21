/* eslint-disable no-undef */
// CSAF product_id: the obfuscation secret moves server-side.
//
// WHAT THIS COVERS. The codec itself (imports/server/csaf/productIdCodec.js) and
// the two pure method handlers (imports/server/csaf/productIdMethods.js), both
// plain CommonJS with no Meteor import, so Jest can require them directly - the
// same shape as imports/server/security/companySecretFields.js.
//
// imports/lib/crypto.js CANNOT be required under Jest (Npm.require at line 2), so
// the codec takes encrypt/decrypt/versionPrefix as injected dependencies. To keep
// criteria 2, 6 and 7 real
// cryptographic behaviour rather than tautologies against a stub, the pair
// injected below is a REAL Node AES-256-GCM implementation mirroring
// crypto.js:116-140 byte for byte (12-byte IV, 16-byte tag, iv|tag|ciphertext
// base64, 'v2:' prefix). A fresh IV per call, an authenticated tag and a
// non-deterministic ciphertext are therefore properties of the cipher, not of a
// fake that was written to agree with the assertion.
//
// The last block LIFTS statements out of imports/lib/converter/vex.js as text and
// executes them: vex.js imports
// meteor/* and cannot be required, but criteria 12-16 are behavioural claims about
// the bytes that ship, not about a re-implementation.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  createProductIdCodec,
  MAX_TOKEN_LENGTH
} = require('../../imports/server/csaf/productIdCodec');
const {
  encodeModuleIds,
  decodeProductIds,
  normalizeIdBatch,
  CSAF_ID_BATCH_MAX,
  CSAF_ID_MAX_LENGTH
} = require('../../imports/server/csaf/productIdMethods');

// ---------------------------------------------------------------------------
// A real AES-256-GCM pair, mirroring imports/lib/crypto.js:116-140
// ---------------------------------------------------------------------------

const VERSION_PREFIX = 'v2:';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY = crypto.createHash('sha256').update('csaf-product-id-spec-secret', 'utf8').digest();

function realEncrypt(text) {
  try {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return VERSION_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
  } catch (error) {
    return undefined;   // crypto.js swallows its own failure the same way
  }
}

// Mirrors crypto.js decryptV2: returns undefined on ANY failure (bad base64,
// truncated payload, failed auth tag).
function realDecrypt(text) {
  try {
    const data = Buffer.from(text.slice(VERSION_PREFIX.length), 'base64');
    const iv = data.subarray(0, IV_LEN);
    const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = data.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch (error) {
    return undefined;
  }
}

// decrypt is spied on so "a non-v2: token NEVER reaches crypto.js decrypt()" is an
// assertion rather than a comment. crypto.js's no-prefix branch is AES-256-CBC-hex
// for a completely different data set, so a non-token must never be routed into it.
let decryptSpy;
function makeCodec(overrides) {
  decryptSpy = jest.fn(realDecrypt);
  return createProductIdCodec(Object.assign({
    encrypt: realEncrypt,
    decrypt: decryptSpy,
    versionPrefix: VERSION_PREFIX
  }, overrides || {}));
}

// Mints a real token for any id, as another company's published document would
// carry one. Its own codec, so minting does not reset decryptSpy.
const MINT_CODEC = createProductIdCodec({encrypt: realEncrypt, decrypt: realDecrypt, versionPrefix: VERSION_PREFIX});
function mintToken(id) {
  return MINT_CODEC.encodeProductId(id);
}

const MODULE_ID = 'abc123def456ghi7';

describe('CSAF product_id codec: construction', () => {
  it('refuses to build without the injected crypto (fails loudly, never silently)', () => {
    expect(() => createProductIdCodec()).toThrow('CSAF productId: crypto is not wired');
    expect(() => createProductIdCodec({decrypt: realDecrypt, versionPrefix: VERSION_PREFIX}))
      .toThrow('CSAF productId: crypto is not wired');
    expect(() => createProductIdCodec({encrypt: realEncrypt, versionPrefix: VERSION_PREFIX}))
      .toThrow('CSAF productId: crypto is not wired');
    expect(() => createProductIdCodec({encrypt: realEncrypt, decrypt: realDecrypt}))
      .toThrow('CSAF productId: crypto is not wired');
  });
});

describe('AC1: encode then decode round-trips, under the v2: scheme', () => {
  it('decodeProductId(encodeProductId(id)) === id', () => {
    const codec = makeCodec();
    expect(codec.decodeProductId(codec.encodeProductId(MODULE_ID))).toBe(MODULE_ID);
  });

  it('the token starts with the version prefix', () => {
    const codec = makeCodec();
    expect(codec.encodeProductId(MODULE_ID).startsWith('v2:')).toBe(true);
  });
});

describe('AC2: a fresh IV per call - the same id never produces the same token twice', () => {
  it('two encodes of one id differ, and both decode back to it', () => {
    const codec = makeCodec();
    const a = codec.encodeProductId(MODULE_ID);
    const b = codec.encodeProductId(MODULE_ID);
    expect(a).not.toBe(b);
    expect(codec.decodeProductId(a)).toBe(MODULE_ID);
    expect(codec.decodeProductId(b)).toBe(MODULE_ID);
  });
});

describe('AC5: encodeProductId throws rather than returning an unusable token', () => {
  it('throws when the underlying encrypt() swallowed its failure and returned undefined', () => {
    const codec = makeCodec({encrypt: () => undefined});
    let returned = 'not-assigned';
    expect(() => {
      returned = codec.encodeProductId(MODULE_ID);
    }).toThrow('CSAF productId: could not encrypt the identifier');
    expect(returned).toBe('not-assigned');   // no value ever came back
  });

  it('throws when encrypt() returned something without the version prefix', () => {
    const codec = makeCodec({encrypt: () => 'no-version-prefix'});
    expect(() => codec.encodeProductId(MODULE_ID))
      .toThrow('CSAF productId: could not encrypt the identifier');
  });

  it('throws for a non-string or empty id instead of encrypting "undefined"', () => {
    const codec = makeCodec();
    expect(() => codec.encodeProductId(undefined)).toThrow('CSAF productId: id must be a non-empty string');
    expect(() => codec.encodeProductId('')).toThrow('CSAF productId: id must be a non-empty string');
    expect(() => codec.encodeProductId(42)).toThrow('CSAF productId: id must be a non-empty string');
    expect(() => codec.encodeProductId({})).toThrow('CSAF productId: id must be a non-empty string');
  });
});

describe('AC6: decodeProductId returns undefined for everything undecodable', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a number', 42],
    ['an object', {}],
    ['an array', ['v2:x']],
    ['a v2: token that is not base64', 'v2:not-base64!!!'],
    ['a v2: token that is empty after the prefix', 'v2:'],
    ['an arbitrary non-v2 string', 'hello']
  ])('%s -> undefined', (_name, input) => {
    const codec = makeCodec();
    expect(codec.decodeProductId(input)).toBeUndefined();
  });

  it('a v2: token with one byte of its auth tag flipped -> undefined (never a garbage string)', () => {
    const codec = makeCodec();
    const token = codec.encodeProductId(MODULE_ID);
    const raw = Buffer.from(token.slice(VERSION_PREFIX.length), 'base64');
    raw[IV_LEN] ^= 0x01;                       // first byte of the GCM tag
    const tampered = VERSION_PREFIX + raw.toString('base64');
    expect(tampered).not.toBe(token);
    expect(codec.decodeProductId(tampered)).toBeUndefined();
  });

  it('never throws and never returns an empty string for any of the above', () => {
    const codec = makeCodec();
    [undefined, null, '', 42, {}, 'hello', 'v2:not-base64!!!', 'not-a-token-zzzz'].forEach((input) => {
      let out;
      expect(() => {
        out = codec.decodeProductId(input);
      }).not.toThrow();
      expect(out).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// The two bulk methods, driven as pure handlers
// ---------------------------------------------------------------------------

const CO = 'co-1';
const OTHER_CO = 'co-2';

// Who owns what. Modules AND products, because the wizard's Products tab encodes
// Product _ids (csaf-create.html:825-826).
const OWNERSHIP = {
  m1: CO,
  m2: CO,
  p1: CO,
  mForeign: OTHER_CO,
  pForeign: OTHER_CO
};

function makeDeps(overrides) {
  const codec = makeCodec();
  const deps = {
    // The REAL encodeIdMap, not a re-implementation: it is what production binds,
    // and its shape (one own key per id) is part of the contract.
    encodeIdMap: jest.fn(codec.encodeIdMap),
    decodeProductId: jest.fn(codec.decodeProductId),
    filterOwnedIds: jest.fn(async (ids, companyId) =>
      new Set(ids.filter((id) => OWNERSHIP[id] === companyId))),
    error: (code, reason) => Object.assign(new Error(reason), {error: code, reason})
  };
  deps.codec = codec;
  return Object.assign(deps, overrides || {});
}

async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the handler to reject, it resolved');
}

describe('AC17: CSAF.EncodeModuleIds returns one v2: token per id, decoding back to that id', () => {
  it('exactly the requested keys, each a token that maps back to its key', async () => {
    const deps = makeDeps();
    const out = await encodeModuleIds(deps, ['m1', 'm2'], CO);
    expect(Object.keys(out).sort()).toEqual(['m1', 'm2']);
    Object.entries(out).forEach(([id, token]) => {
      expect(token.startsWith('v2:')).toBe(true);
      expect(deps.codec.decodeProductId(token)).toBe(id);
    });
  });

  it('deduplicates repeated ids into a single key', async () => {
    const out = await encodeModuleIds(makeDeps(), ['m1', 'm1', 'm2'], CO);
    expect(Object.keys(out).sort()).toEqual(['m1', 'm2']);
  });

  it('an empty batch resolves to an empty map without touching the codec', async () => {
    const deps = makeDeps();
    await expect(encodeModuleIds(deps, [], CO)).resolves.toEqual({});
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
  });
});

describe('AC18/AC19: encode is all-or-nothing and is not an existence oracle', () => {
  it('a foreign id rejects with 403 and yields no tokens for the rest of the batch', async () => {
    const deps = makeDeps();
    const error = await caught(encodeModuleIds(deps, ['m1', 'mForeign'], CO));
    expect(error.error).toBe(403);
    expect(error.reason).toBe('Access Denied');
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
  });

  it('an id that exists nowhere rejects with the IDENTICAL error as a foreign id', async () => {
    const deps = makeDeps();
    const foreign = await caught(encodeModuleIds(deps, ['m1', 'mForeign'], CO));
    const missing = await caught(encodeModuleIds(deps, ['m1', 'no-such-id-anywhere'], CO));
    expect(missing.error).toBe(foreign.error);
    expect(missing.reason).toBe(foreign.reason);
    expect(missing.message).toBe(foreign.message);
  });

  it('a caller with no resolvable company is refused', async () => {
    const error = await caught(encodeModuleIds(makeDeps(), ['m1'], undefined));
    expect(error.error).toBe(403);
  });
});

describe('AC20: product ids round-trip exactly like module ids', () => {
  it('encodes an owned product id', async () => {
    const deps = makeDeps();
    const out = await encodeModuleIds(deps, ['m1', 'p1'], CO);
    expect(Object.keys(out).sort()).toEqual(['m1', 'p1']);
    expect(deps.codec.decodeProductId(out.p1)).toBe('p1');
  });

  it('rejects another company\'s product id exactly as it rejects a foreign module id', async () => {
    const deps = makeDeps();
    const foreignProduct = await caught(encodeModuleIds(deps, ['pForeign'], CO));
    const foreignModule = await caught(encodeModuleIds(deps, ['mForeign'], CO));
    expect(foreignProduct.error).toBe(foreignModule.error);
    expect(foreignProduct.reason).toBe(foreignModule.reason);
  });

  it('decode returns null for another company\'s product token, exactly as for a module token', async () => {
    const deps = makeDeps();
    const tokens = [deps.codec.encodeProductId('pForeign'), deps.codec.encodeProductId('mForeign')];
    const out = await decodeProductIds(deps, tokens, CO);
    expect(out[tokens[0]]).toBeNull();
    expect(out[tokens[1]]).toBeNull();
  });

  it('decode resolves an owned product token to the product id', async () => {
    const deps = makeDeps();
    const token = deps.codec.encodeProductId('p1');
    await expect(decodeProductIds(deps, [token], CO)).resolves.toEqual({[token]: 'p1'});
  });
});

describe('AC21/AC22: decode is tenant-scoped and reports per-token', () => {
  it('resolves two tokens of the caller\'s own modules', async () => {
    const deps = makeDeps();
    const tA = deps.codec.encodeProductId('m1');
    const tB = deps.codec.encodeProductId('m2');
    await expect(decodeProductIds(deps, [tA, tB], CO)).resolves.toEqual({[tA]: 'm1', [tB]: 'm2'});
  });

  it('returns the key with a null value for a foreign id, a vanished id and garbage', async () => {
    const deps = makeDeps();
    const foreign = deps.codec.encodeProductId('mForeign');
    const vanished = deps.codec.encodeProductId('deleted-module-id');
    const garbage = 'definitely-not-a-token';
    const out = await decodeProductIds(deps, [foreign, vanished, garbage], CO);
    expect(Object.keys(out).sort()).toEqual([foreign, garbage, vanished].sort());
    expect(out[foreign]).toBeNull();
    expect(out[vanished]).toBeNull();
    expect(out[garbage]).toBeNull();
  });

  it('never leaks the decoded id of a non-owned document anywhere in the response', async () => {
    const deps = makeDeps();
    const foreign = deps.codec.encodeProductId('mForeign');
    const out = await decodeProductIds(deps, [foreign], CO);
    expect(JSON.stringify(out)).not.toContain('mForeign');
  });

  it('a caller with no resolvable company is refused before any decrypt work', async () => {
    const deps = makeDeps();
    const error = await caught(decodeProductIds(deps, ['v2:whatever'], undefined));
    expect(error.error).toBe(403);
    expect(deps.decodeProductId).not.toHaveBeenCalled();
  });
});

describe('the response is a plain map even for a hostile key', () => {
  // A product_id comes out of an UPLOADED CSAF document (csaf-import-modal), so a
  // token can be any string at all. `result['__proto__'] = null` on an object
  // literal sets the prototype instead of creating an own property, and the key
  // vanishes from the response - a silently dropped entry the client reads as
  // "not decodable", with no error anywhere.
  const HOSTILE = ['__proto__', 'constructor', 'toString'];

  it('decode returns every requested token as an OWN key', async () => {
    const deps = makeDeps();
    const out = await decodeProductIds(deps, HOSTILE, CO);
    HOSTILE.forEach((token) => {
      expect(Object.prototype.hasOwnProperty.call(out, token)).toBe(true);
      expect(out[token]).toBeNull();
    });
    expect(Object.keys(out).sort()).toEqual([...HOSTILE].sort());
  });

  it('decode does not mutate the prototype of its own result', async () => {
    const out = await decodeProductIds(makeDeps(), ['__proto__'], CO);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('encode returns every requested id as an OWN key', async () => {
    const deps = makeDeps({
      // These ids are not in OWNERSHIP, and the point here is the response shape,
      // not the tenant check - so ownership is satisfied for the whole batch.
      filterOwnedIds: async (ids) => new Set(ids)
    });
    const out = await encodeModuleIds(deps, HOSTILE, CO);
    HOSTILE.forEach((id) => {
      expect(Object.prototype.hasOwnProperty.call(out, id)).toBe(true);
      expect(deps.codec.decodeProductId(out[id])).toBe(id);
    });
    expect(Object.keys(out).sort()).toEqual([...HOSTILE].sort());
  });

  // --- what actually crosses the wire -------------------------------------
  // Both responses are keyed by a string the caller supplied, so the question is
  // whether an own `__proto__` key survives DDP. On the EJSON this app pins
  // (ejson@1.2.0, .meteor/versions:42) it does: stringifyDDP serialises through
  // the copy-on-write EJSON.toJSONValue, JSON.parse creates `__proto__` as an OWN
  // property, and parseDDP's EJSON._adjustTypesFromJSONValue mutates in place and
  // skips string/null values entirely. EJSON.clone - which DOES drop such a key,
  // rebuilding with `ret[key] = ...` - is applied by ddp-client to method ARGS,
  // never to the result. (An older EJSON routed fromJSONValue through clone; that
  // is not the pinned version.)
  //
  // The map-keyed shape is still the fragile part of this contract. See the note
  // in imports/server/csaf/productIdMethods.js.
  it('a hostile key survives the JSON encoding DDP actually puts it through', () => {
    const wire = JSON.parse(JSON.stringify(
      Object.fromEntries(HOSTILE.map((token) => [token, 'm1']))));
    HOSTILE.forEach((token) => {
      expect(Object.prototype.hasOwnProperty.call(wire, token)).toBe(true);
      expect(wire[token]).toBe('m1');
    });
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
  });

  it('DECODE IS IMMUNE regardless: a __proto__ token can never decode, so its value is always null', async () => {
    // Independent of any EJSON version. A token has to carry the `v2:` prefix to
    // reach a cipher at all, and no prototype-key string can. The entry is therefore always null - which is
    // exactly what a client that never received the key concludes anyway, so the
    // two are indistinguishable to the caller.
    const codec = makeCodec();
    HOSTILE.forEach((token) => {
      expect(codec.decodeProductId(token)).toBeUndefined();
    });
    const out = await decodeProductIds(makeDeps(), HOSTILE, CO);
    HOSTILE.forEach((token) => expect(out[token]).toBeNull());
  });
});

describe('AC26: batch validation rejects with 400 and does no crypto work', () => {
  const NOT_ARRAYS = [undefined, null, 'm1', 42, {m1: 1}];

  it.each(NOT_ARRAYS)('encode: a non-array argument (%p) is a 400', async (value) => {
    const deps = makeDeps();
    const error = await caught(encodeModuleIds(deps, value, CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('Invalid ids');
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
    expect(deps.filterOwnedIds).not.toHaveBeenCalled();
  });

  it.each(NOT_ARRAYS)('decode: a non-array argument (%p) is a 400 with no decrypt work', async (value) => {
    const deps = makeDeps();
    const error = await caught(decodeProductIds(deps, value, CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('Invalid tokens');
    expect(deps.decodeProductId).not.toHaveBeenCalled();
    expect(deps.filterOwnedIds).not.toHaveBeenCalled();
  });

  it.each([
    ['a number element', ['m1', 7]],
    ['a null element', ['m1', null]],
    ['an empty-string element', ['m1', '']],
    ['an object element', ['m1', {}]]
  ])('encode: %s is a 400 with no crypto work', async (_name, value) => {
    const deps = makeDeps();
    const error = await caught(encodeModuleIds(deps, value, CO));
    expect(error.error).toBe(400);
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
  });

  it.each([
    ['a number element', ['v2:a', 7]],
    ['a null element', ['v2:a', null]],
    ['an empty-string element', ['v2:a', '']],
    ['an object element', ['v2:a', {}]]
  ])('decode: %s is a 400 with no decrypt work', async (_name, value) => {
    const deps = makeDeps();
    const error = await caught(decodeProductIds(deps, value, CO));
    expect(error.error).toBe(400);
    expect(deps.decodeProductId).not.toHaveBeenCalled();
  });

  it('encode: a batch over the cap is a 400 naming the cap, checked before dedupe or query', async () => {
    const deps = makeDeps();
    // All the same id, so a dedupe-first implementation would see a batch of ONE
    // and let it through - which is exactly the DoS this cap exists to stop.
    const oversized = new Array(CSAF_ID_BATCH_MAX + 1).fill('m1');
    const error = await caught(encodeModuleIds(deps, oversized, CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe(`Too many ids (max ${CSAF_ID_BATCH_MAX})`);
    expect(deps.filterOwnedIds).not.toHaveBeenCalled();
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
  });

  it('decode: a batch over the cap is a 400 naming the cap, checked before any decrypt', async () => {
    const deps = makeDeps();
    const oversized = new Array(CSAF_ID_BATCH_MAX + 1).fill('v2:aaaa');
    const error = await caught(decodeProductIds(deps, oversized, CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe(`Too many tokens (max ${CSAF_ID_BATCH_MAX})`);
    expect(deps.decodeProductId).not.toHaveBeenCalled();
  });

  it('a batch exactly at the cap is accepted', async () => {
    const deps = makeDeps();
    const atCap = new Array(CSAF_ID_BATCH_MAX).fill('m1');
    await expect(encodeModuleIds(deps, atCap, CO)).resolves.toEqual(
      expect.objectContaining({m1: expect.stringMatching(/^v2:/)}));
  });

  it('the cap is declared once and exported (no second copy in the message)', () => {
    expect(CSAF_ID_BATCH_MAX).toBe(1000);
    // ...and the claim in the title, asserted rather than implied: the number the
    // client is told must come from that one declaration, so the two cannot drift.
    const live = stripComments(fs.readFileSync(
      path.join(__dirname, '../../imports/server/csaf/productIdMethods.js'), 'utf8'));
    expect(live).toMatch(/const CSAF_ID_BATCH_MAX = \d+;/);
    expect(live).toMatch(/Too many ids \(max \$\{CSAF_ID_BATCH_MAX\}\)/);
    expect(live).toMatch(/Too many tokens \(max \$\{CSAF_ID_BATCH_MAX\}\)/);
    // No hard-coded second copy of the number anywhere else in the module.
    expect(live.match(/\b1000\b/g) || []).toHaveLength(1);
  });
});

describe('normalizeIdBatch: the shared validator', () => {
  it('dedupes while keeping order', () => {
    expect(normalizeIdBatch(['b', 'a', 'b'])).toEqual(['b', 'a']);
  });
  it('returns null for anything invalid', () => {
    expect(normalizeIdBatch(undefined)).toBeNull();
    expect(normalizeIdBatch('a')).toBeNull();
    expect(normalizeIdBatch(['a', 1])).toBeNull();
    expect(normalizeIdBatch(['a', ''])).toBeNull();
  });
  it('returns an empty array for an empty batch (valid, just nothing to do)', () => {
    expect(normalizeIdBatch([])).toEqual([]);
  });
  it('bounds element LENGTH, not just element count', () => {
    // Security review finding 1: the cap bounded how MANY values a caller could
    // send but not how long each one was, so a 1000-element batch of
    // arbitrarily long strings passed validation and every one of them was run
    // through a cipher whole.
    expect(normalizeIdBatch(['a'.repeat(CSAF_ID_MAX_LENGTH)]))
      .toEqual(['a'.repeat(CSAF_ID_MAX_LENGTH)]);
    expect(normalizeIdBatch(['a'.repeat(CSAF_ID_MAX_LENGTH + 1)])).toBeNull();
    expect(normalizeIdBatch(['m1', 'a'.repeat(CSAF_ID_MAX_LENGTH + 1)])).toBeNull();
  });
  it('the cap is generous enough for every token either method really carries', () => {
    // A v2: token for a 17-character id is ~63 characters. Non-vacuity for the bound above: it must not be sitting anywhere near
    // a real token.
    expect(CSAF_ID_MAX_LENGTH).toBeGreaterThan(256);
  });
  it('agrees with the codec\'s own screen, which is a second declaration of it', () => {
    // The validator and the codec each hold the bound, so that remove.js - which
    // never reaches this validator - is still screened. Nothing in the build
    // couples them, so this is what stops them drifting apart.
    expect(CSAF_ID_MAX_LENGTH).toBe(MAX_TOKEN_LENGTH);
  });
});

describe('finding 1: element length is bounded end to end, with no cipher work', () => {
  const TOO_LONG = 'a'.repeat(CSAF_ID_MAX_LENGTH + 1);

  it('encode: an over-long id is a 400 and mints nothing', async () => {
    const deps = makeDeps();
    const error = await caught(encodeModuleIds(deps, ['m1', TOO_LONG], CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('Invalid ids');
    expect(deps.encodeIdMap).not.toHaveBeenCalled();
    expect(deps.filterOwnedIds).not.toHaveBeenCalled();
  });

  it('decode: an over-long token is a 400 and decrypts nothing', async () => {
    const deps = makeDeps();
    const error = await caught(decodeProductIds(deps, [`v2:${TOO_LONG}`], CO));
    expect(error.error).toBe(400);
    expect(error.reason).toBe('Invalid tokens');
    expect(deps.decodeProductId).not.toHaveBeenCalled();
    expect(deps.filterOwnedIds).not.toHaveBeenCalled();
  });

  it('the codec screens length itself, so callers outside the methods are bounded too', () => {
    // remove.js decodes every product_id of an uploaded document without going
    // through normalizeIdBatch, and neither csaf/create.js nor CSAFSchema caps
    // the document size. The screen has to sit in the codec as well, before any
    // cipher is handed the value.
    const codec = makeCodec();
    const huge = 'a'.repeat(200000);
    expect(codec.decodeProductId(`v2:${huge}`)).toBeUndefined();
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it('NON-VACUITY: a token at the limit still goes through the cipher normally', () => {
    const codec = makeCodec();
    const token = codec.encodeProductId(MODULE_ID);
    expect(token.length).toBeLessThan(MAX_TOKEN_LENGTH);
    expect(codec.decodeProductId(token)).toBe(MODULE_ID);
    expect(decryptSpy).toHaveBeenCalled();
  });
});

describe('AC500: an encode failure surfaces as a 500, not as a broken document', () => {
  it('wraps a throwing encodeIdMap', async () => {
    const deps = makeDeps({
      encodeIdMap: () => {
        throw new Error('CSAF productId: could not encrypt the identifier');
      }
    });
    const error = await caught(encodeModuleIds(deps, ['m1'], CO));
    expect(error.error).toBe(500);
    expect(error.reason).toBe('Could not encode product ids');
  });
});

// ---------------------------------------------------------------------------
// vex.js renders the tokens its caller handed it (criteria 12-16)
//
// vex.js imports meteor/* and cannot be required under Jest. Rather than
// re-implement the branch builder here (a copy that would agree with itself
// forever), these blocks are LIFTED out of vex.js as text and EXECUTED. If the
// shipped shape
// changes, extraction throws loudly instead of passing against a stale copy.
// ---------------------------------------------------------------------------

const VEX_JS = 'imports/lib/converter/vex.js';

function readRepo(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const VEX_SRC = stripComments(readRepo(VEX_JS));

// Slice from `marker` to the character that closes the first `open` after it.
// `fileLabel` is named in the failure: this helper serves both the vex.js lifts
// and the remove.js one below, and a message that always said "vex.js" pointed at
// the wrong source half the time it fired.
function sliceBalanced(source, marker, open, close, fileLabel = VEX_JS) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `${fileLabel} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = source.indexOf(open, start); i < source.length; i++) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open}${close} while slicing ${marker} from ${fileLabel}`);
}

// --- the lifted pieces -------------------------------------------------------

// The productIds guard, executed as a statement block.
const GUARD_BLOCK = (function () {
  const start = /^[ \t]*if \(!productIds/m.exec(VEX_SRC);
  const end = /^[ \t]*\}\);[ \t]*$/m;
  if (!start) {
    throw new Error('vex.js has no `if (!productIds ...` guard - criterion 13 lost its coverage');
  }
  const rest = VEX_SRC.slice(start.index);
  const endMatch = end.exec(rest);
  if (!endMatch) throw new Error('could not find the end of the productIds guard block');
  return rest.slice(0, endMatch.index + endMatch[0].length);
})();

const runGuard = new Function('productIds', 'modules', '_', GUARD_BLOCK);

// The branch builder.
const BRANCHES_BLOCK = sliceBalanced(VEX_SRC, 'let branchesModules = _.map(modules', '(', ')');
const runBranches = new Function(
  'modules', 'productIds', '_', 'toPurl', 'Config', 'moment',
  `${BRANCHES_BLOCK}\nreturn branchesModules;`);

// toPurl, lifted whole so the purl / x_generic_uris split is the shipped one.
const toPurl = new Function(`${sliceBalanced(VEX_SRC, 'function toPurl(', '{', '}')}\nreturn toPurl;`)();

// moduleToProductVersion, lifted whole.
const moduleToProductVersion = new Function(
  'moment',
  `${sliceBalanced(VEX_SRC, 'async function moduleToProductVersion(', '{', '}')}\nreturn moduleToProductVersion;`
)({toISOString: () => '1970-01-01T00:00:00.000Z'});

// The product_ids computation inside vulnerabilityToCVE.
const PRODUCT_IDS_STMT = (function () {
  const start = VEX_SRC.search(/^[ \t]*let product_ids = /m);
  if (start === -1) throw new Error('vex.js no longer has a `let product_ids = ...` statement');
  // Taken through balanced parentheses rather than to end of line: the statement
  // spans several lines since it gained the hasOwnProperty guard on the cryptoMap
  // lookup, and slicing only its first line yields a syntax error.
  let depth = 0;
  for (let i = VEX_SRC.indexOf('(', start); i < VEX_SRC.length; i++) {
    if (VEX_SRC[i] === '(') depth += 1;
    else if (VEX_SRC[i] === ')') {
      depth -= 1;
      if (depth === 0) return VEX_SRC.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced parentheses in the vex.js product_ids statement');
})();
const runProductIds = new Function(
  'productIds', 'cryptoMap', 'paths', '_', `${PRODUCT_IDS_STMT}\nreturn product_ids;`);

// The self reference URL expression.
const SELF_URL_EXPR = (function () {
  const match = /url: (`[^`]*csaf\/json[^`]*`)/.exec(VEX_SRC);
  if (!match) throw new Error('vex.js no longer builds a `csaf/json/...` self URL');
  return match[1];
})();
const runSelfUrl = new Function('Config', 'id', `return ${SELF_URL_EXPR};`);

const _u = require('underscore');
const CONFIG = {appUrl: 'https://app.example.io/'};
const MOMENT = () => ({toISOString: () => '1970-01-01T00:00:00.000Z'});

describe('the vex.js blocks under test really came out of vex.js', () => {
  it('lifted a guard, a branch builder, a product_ids statement and a self URL', () => {
    expect(GUARD_BLOCK).toMatch(/productIds/);
    expect(BRANCHES_BLOCK).toMatch(/product_id/);
    expect(PRODUCT_IDS_STMT).toMatch(/cryptoMap/);
    expect(SELF_URL_EXPR).toMatch(/csaf\/json/);
  });
});

describe('AC12: the branch product_id is the caller\'s token, never recomputed', () => {
  it('product_tree carries exactly the token supplied for that module', () => {
    const branches = runBranches(
      [{_id: 'm1', name: 'left-pad', version: '1.0.0', key: 'npm:left-pad'}],
      {m1: 'TOKEN-1'}, _u, toPurl, CONFIG, MOMENT);
    expect(branches).toHaveLength(1);
    expect(branches[0].product.product_id).toBe('TOKEN-1');
  });

  it('moduleToProductVersion(module, token) carries the token it was given', async () => {
    const out = await moduleToProductVersion({_id: 'm1', name: 'left-pad', version: '2.0.0'}, 'TOKEN-2');
    expect(out.product.product_id).toBe('TOKEN-2');
    expect(out.product.name).toBe('left-pad');
    expect(out.category).toBe('product_version');
  });

  it('moduleToProductVersion falls back to the token as the version name, as before', async () => {
    const out = await moduleToProductVersion({_id: 'm1', name: 'left-pad'}, 'TOKEN-3');
    expect(out.name).toBe('TOKEN-3');
  });

  it('moduleToProductVersion refuses a missing token instead of emitting product_id: undefined', async () => {
    await expect(moduleToProductVersion({_id: 'm9', name: 'x'}, undefined))
      .rejects.toThrow('VEX: missing product_id for module');
    await expect(moduleToProductVersion({_id: 'm9', name: 'x'}, '')).rejects.toThrow(/missing product_id/);
  });

  it('...and does not name the module in the message', async () => {
    // Security review finding 4. imports/server/rest-api/releases.js served this
    // message verbatim on /api/v2/compliance/releases/:id/csaf, an unauthenticated route, so
    // the id it used to carry was a raw internal `_id` on exactly the surface the
    // product_id encoding exists to keep it off. releases.js no longer echoes
    // any message at all, but the id is dropped at the source as well - vex.js is
    // client-bundled and reachable from callers this spec does not know about.
    const error = await moduleToProductVersion({_id: 'nA7ZqKxLmP3vTbW9c', name: 'x'}, undefined)
      .then(() => null, (thrown) => thrown);
    expect(error).not.toBeNull();
    expect(error.message).toBe('VEX: missing product_id for module');
    expect(error.message).not.toContain('nA7ZqKxLmP3vTbW9c');
  });
});

describe('AC13: a module with no token stops the whole generation', () => {
  it('throws before any branch is built, without naming the module', () => {
    expect(() => runGuard({m1: 'T1'}, [{_id: 'nA7ZqKxLmP3vTbW9c'}], _u))
      .toThrow('VEX: missing product_id for module');
    let thrown;
    try {
      runGuard({m1: 'T1'}, [{_id: 'm1'}, {_id: 'nA7ZqKxLmP3vTbW9c'}], _u);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.message).toBe('VEX: missing product_id for module');
  });

  it('throws when productIds is missing entirely', () => {
    expect(() => runGuard(undefined, [{_id: 'm1'}], _u)).toThrow('VEX: productIds map is required');
    expect(() => runGuard('nope', [{_id: 'm1'}], _u)).toThrow('VEX: productIds map is required');
  });

  it('rejects a blank / non-string token as firmly as a missing one', () => {
    expect(() => runGuard({m1: ''}, [{_id: 'm1'}], _u)).toThrow(/missing product_id for module/);
    expect(() => runGuard({m1: 42}, [{_id: 'm1'}], _u)).toThrow(/missing product_id for module/);
    expect(() => runGuard({m1: null}, [{_id: 'm1'}], _u)).toThrow(/missing product_id for module/);
  });

  it('passes for a complete map', () => {
    expect(() => runGuard({m1: 'T1', m2: 'T2'}, [{_id: 'm1'}, {_id: 'm2'}], _u)).not.toThrow();
    expect(() => runGuard({}, [], _u)).not.toThrow();
  });

  it('no branch a complete map produces has a blank product_id', () => {
    const branches = runBranches(
      [{_id: 'm1', name: 'a', key: 'npm:a'}, {_id: 'm2', name: 'b'}],
      {m1: 'T1', m2: 'T2'}, _u, toPurl, CONFIG, MOMENT);
    branches.forEach((branch) => {
      expect(typeof branch.product.product_id).toBe('string');
      expect(branch.product.product_id).not.toBe('');
    });
  });
});

describe('AC14: every product_id referenced by a vulnerability exists in the product tree', () => {
  it('a path pointing at a module outside the set contributes nothing (no undefined leaks in)', () => {
    const ids = runProductIds(
      null, {m1: 'T1'}, [{moduleId: 'm1'}, {moduleId: 'mX'}, {moduleId: 'm1'}], _u);
    expect(ids).toEqual(['T1']);
    expect(ids).not.toContain(undefined);
  });

  it('an all-unknown path list yields an empty product_ids rather than [undefined]', () => {
    expect(runProductIds(null, {m1: 'T1'}, [{moduleId: 'mX'}], _u)).toEqual([]);
  });

  it('a prototype-chain key contributes nothing either', () => {
    // Security review finding 5. `cryptoMap[path.moduleId]` was an unguarded
    // property read, so a path whose moduleId spelled `toString`, `constructor`
    // or `valueOf` returned a FUNCTION from Object.prototype. A function is
    // truthy, so _.compact keeps it, and JSON.stringify renders it as null - a
    // `product_status` entry of null in a published advisory, referring to no
    // branch in the product_tree. `hasOwnProperty` is the whole fix.
    ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'].forEach((key) => {
      const ids = runProductIds(null, {m1: 'T1'}, [{moduleId: 'm1'}, {moduleId: key}], _u);
      expect(ids).toEqual(['T1']);
      ids.forEach((id) => expect(typeof id).toBe('string'));
      expect(JSON.stringify(ids)).not.toContain('null');
    });
  });

  it('an OWN key of that name is still honoured - the guard narrows nothing real', () => {
    // Non-vacuity: a module whose _id really is `toString` (Modules has no
    // attached schema) still resolves, because its entry is an own property.
    const map = Object.fromEntries([['toString', 'T-OWN'], ['m1', 'T1']]);
    expect(runProductIds(null, map, [{moduleId: 'toString'}, {moduleId: 'm1'}], _u))
      .toEqual(['T-OWN', 'T1']);
  });

  it('survives a missing map and a malformed path entry', () => {
    expect(runProductIds(null, undefined, [{moduleId: 'm1'}], _u)).toEqual([]);
    expect(runProductIds(null, {m1: 'T1'}, [null, undefined, {}, {moduleId: 'm1'}], _u))
      .toEqual(['T1']);
  });

  it('an explicit productIds argument still wins (vulnerabilityToCVE signature unchanged)', () => {
    expect(runProductIds(['GIVEN'], {m1: 'T1'}, [{moduleId: 'm1'}], _u)).toEqual(['GIVEN']);
  });

  it('holds over an assembled document: every referenced STRING id is in the tree', () => {
    const productIds = {m1: 'T1', m2: 'T2'};
    const branches = runBranches(
      [{_id: 'm1', name: 'a', key: 'npm:a'}, {_id: 'm2', name: 'b', key: 'npm:b'}],
      productIds, _u, toPurl, CONFIG, MOMENT);
    const ids = runProductIds(null, productIds,
      [{moduleId: 'm1'}, {moduleId: 'm2'}, {moduleId: 'gone'}], _u);

    const doc = {
      product_tree: {branches: [{branches: [{branches}]}]},
      vulnerabilities: [{
        product_status: {known_affected: ids, under_investigation: ids},
        remediations: [{category: 'none_available', product_ids: ids}],
        // The pre-existing vex.js nested-array bug (a merged CVE pushes an ARRAY
        // into threats[0].product_ids). Deliberately reproduced: this criterion is
        // about strings, and the bug is verifiable at the baseline commit and is
        // NOT fixed by this change.
        threats: [{category: 'impact', product_ids: [...ids, ids]}],
        scores: [{cvss_v2: {}, products: ids}]
      }]
    };

    const known = new Set(
      doc.product_tree.branches[0].branches[0].branches.map((b) => b.product.product_id));
    const referenced = [];
    doc.vulnerabilities.forEach((v) => {
      Object.values(v.product_status || {}).forEach((arr) => referenced.push(...(arr || [])));
      (v.remediations || []).forEach((r) => referenced.push(...(r.product_ids || [])));
      (v.threats || []).forEach((t) => referenced.push(...(t.product_ids || [])));
      (v.scores || []).forEach((s) => referenced.push(...(s.products || [])));
    });
    const strings = referenced.filter((id) => typeof id === 'string');
    expect(strings.length).toBeGreaterThan(0);
    strings.forEach((id) => expect(known.has(id)).toBe(true));
    expect(referenced).not.toContain(undefined);
  });
});

describe('AC15: the self URL carries the tracking id verbatim, unencrypted', () => {
  it('is ${appUrl}csaf/json/${trackingId}.json', () => {
    const url = runSelfUrl(CONFIG, 'tsvx-2026-Ab3Cd5Ef7G');
    expect(url).toBe('https://app.example.io/csaf/json/tsvx-2026-Ab3Cd5Ef7G.json');
  });

  it('contains no v2: token', () => {
    const url = runSelfUrl(CONFIG, 'tsvx-2026-Ab3Cd5Ef7G');
    expect(url).not.toContain('v2:');
  });

  it('is built from this installation\'s address only, never a hosted default', () => {
    expect(SELF_URL_EXPR).not.toMatch(/trustsource\.io/);
    expect(runSelfUrl({appUrl: 'https://ts.example.org/'}, 'tsvx-2026-x')).toBe('https://ts.example.org/csaf/json/tsvx-2026-x.json');
  });
});

describe('AC16: the purl-less fallback URI carries that branch\'s own token, and no raw _id', () => {
  const codec = makeCodec();
  const RAW_ID = 'rawModuleIdentifier01';

  function purllessBranch() {
    const token = codec.encodeProductId(RAW_ID);
    const branches = runBranches(
      [{_id: RAW_ID, name: 'no-purl-module', version: '1.0.0'}],
      {[RAW_ID]: token}, _u, toPurl, CONFIG, MOMENT);
    return {branch: branches[0], token, branches};
  }

  it('emits x_generic_uris (not a purl) for a module with no derivable purl', () => {
    const {branch} = purllessBranch();
    expect(branch.product.product_identification_helper.purl).toBeUndefined();
    expect(branch.product.product_identification_helper.x_generic_uris).toHaveLength(1);
  });

  it('the uri ends with module/<that branch\'s own product_id>, url-encoded', () => {
    const {branch, token} = purllessBranch();
    const uri = branch.product.product_identification_helper.x_generic_uris[0].uri;
    expect(token.startsWith('v2:')).toBe(true);
    expect(branch.product.product_id).toBe(token);
    expect(uri.endsWith(`module/${encodeURIComponent(token)}`)).toBe(true);
  });

  it('the module\'s raw _id appears nowhere in the serialised branch', () => {
    const {branches} = purllessBranch();
    expect(JSON.stringify(branches)).not.toContain(RAW_ID);
  });

  it('a module WITH a purl keeps emitting the purl and no x_generic_uris', () => {
    const branches = runBranches(
      [{_id: 'm1', name: 'left-pad', version: '1.0.0', key: 'npm:left-pad'}],
      {m1: 'T1'}, _u, toPurl, CONFIG, MOMENT);
    expect(branches[0].product.product_identification_helper).toEqual({purl: 'pkg:npm/left-pad@1.0.0'});
  });
});

// ---------------------------------------------------------------------------
// AC28: removing a CSAF document acts only on the ids it could actually decode
//
// remove.js imports meteor/*, so its unmute/open-risk block is lifted and executed
// the same way the vex.js blocks above are. This is the ONE path in the app where
// a product_id drives a database write: unmuteVulnerability does an unscoped
// Modules.findOneAsync and openRisk stamps the caller's companyId onto whatever
// moduleId it is handed.
// ---------------------------------------------------------------------------

const REMOVE_JS = 'imports/lib/interactors/csaf/remove.js';
const REMOVE_SRC = stripComments(readRepo(REMOVE_JS));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const REMOVE_ACTIONS_BLOCK = sliceBalanced(
  REMOVE_SRC, 'if(params && (params.unmuteVulnerabilities || params.openRisks)){', '{', '}',
  REMOVE_JS);

const REMOVE_FREE_VARS = [
  // `decodeToken`, not `decodeProductId`: the block goes through the per-document
  // decoder built in remove()'s body (dedupe + cap, covered by
  // test_api/specs/csaf-remove-decode-bounds.unit.spec.js), which is declared
  // outside this block and so arrives here as a free variable.
  'params', 'csaf', 'user', '_', 'decodeToken', 'unmuteVulnerability', 'openRisk',
  'filterOwnedModuleIds'
];

const runRemoveActions = new AsyncFunction(...REMOVE_FREE_VARS, REMOVE_ACTIONS_BLOCK);

// Every product_status shape remove.js reads, in one document.
function csafDocument(productIds) {
  return {
    data: JSON.stringify({
      document: {category: 'csaf_vex'},
      vulnerabilities: [{cve: 'CVE-2026-1234', product_status: {known_affected: productIds}}]
    })
  };
}

// Modules only - remove.js writes into Modules, so a product id must not satisfy
// its ownership check even when the same company owns the product.
const MODULE_OWNERSHIP = {m1: CO, m2: CO, mForeign: OTHER_CO};

async function runRemoval(productIds, overrides) {
  const codec = makeCodec();
  const world = {unmuted: [], risks: [], ownershipCalls: []};
  const filterOwnedModuleIds = (overrides || {}).filterOwnedModuleIds
    || (async (ids, companyId) => {
      world.ownershipCalls.push({ids, companyId});
      return new Set(ids.filter((id) => MODULE_OWNERSHIP[id] === companyId));
    });
  await runRemoveActions(
    Object.assign({unmuteVulnerabilities: true, openRisks: true}, (overrides || {}).params),
    csafDocument(productIds),
    {_id: 'u-1', profile: {companyId: CO}},
    require('underscore'),
    codec.decodeProductId,
    async (cveKey, moduleId) => world.unmuted.push({cveKey, moduleId}),
    async (user, cveKey, moduleId) => world.risks.push({user: user._id, cveKey, moduleId}),
    filterOwnedModuleIds
  );
  world.codec = codec;
  return world;
}

describe('the remove.js block under test really came out of remove.js', () => {
  it('lifted the unmute / open-risk block, decode included', () => {
    expect(REMOVE_ACTIONS_BLOCK).toContain('decodeToken(');
    // The AC29 fix itself. Without this line the ownership scoping could be
    // deleted from remove.js and this meta-test would still say the block was
    // lifted intact.
    expect(REMOVE_ACTIONS_BLOCK).toContain('filterOwnedModuleIds(');
    expect(REMOVE_ACTIONS_BLOCK).toContain('unmuteVulnerability(');
    expect(REMOVE_ACTIONS_BLOCK).toContain('openRisk(');
  });
});

describe('AC28: an undecodable token is skipped, the decodable one still acts', () => {
  it('unmutes and opens a risk for the decodable id only', async () => {
    const codec = makeCodec();
    const good = codec.encodeProductId('m1');
    const world = await runRemoval([good, 'total-garbage-token']);
    expect(world.unmuted).toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
    expect(world.risks).toEqual([{user: 'u-1', cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
  });

  it('never invokes either action with undefined or an empty string', async () => {
    const codec = makeCodec();
    const world = await runRemoval([
      codec.encodeProductId('m1'), 'hello', 'v2:not-base64!!!', 'v2:'
    ]);
    expect([...world.unmuted, ...world.risks]).toHaveLength(2);
    [...world.unmuted, ...world.risks].forEach((call) => {
      expect(typeof call.moduleId).toBe('string');
      expect(call.moduleId).not.toBe('');
      expect(call.moduleId).toBe('m1');
    });
  });

  it('a document whose every token is undecodable performs no action at all', async () => {
    const world = await runRemoval(['hello', 'nope']);
    expect(world.unmuted).toEqual([]);
    expect(world.risks).toEqual([]);
  });

  it('a vulnerability with no product_status at all does not blow up the removal', async () => {
    // The pre-change shape left moduleIds undefined here, and `for...of undefined`
    // throws - which would abort the whole removal.
    const world = {unmuted: [], risks: []};
    await expect(runRemoveActions(
      {unmuteVulnerabilities: true, openRisks: true},
      {data: JSON.stringify({document: {category: 'csaf_vex'}, vulnerabilities: [{cve: 'CVE-1'}]})},
      {_id: 'u-1', profile: {companyId: CO}},
      require('underscore'),
      makeCodec().decodeProductId,
      async (cveKey, moduleId) => world.unmuted.push({cveKey, moduleId}),
      async (user, cveKey, moduleId) => world.risks.push({cveKey, moduleId}),
      async () => new Set()
    )).resolves.toBeUndefined();
    expect(world.unmuted).toEqual([]);
  });

  it('honours the individual action flags', async () => {
    const codec = makeCodec();
    const token = codec.encodeProductId('m1');
    const onlyUnmute = await runRemoval([token], {params: {unmuteVulnerabilities: true, openRisks: false}});
    expect(onlyUnmute.unmuted).toHaveLength(1);
    expect(onlyUnmute.risks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC29: a token naming ANOTHER company's module drives no write
//
// The live defect this closes: unmuteVulnerability does an unscoped
// Modules.findOneAsync(moduleId) and then writes cveConfig.whitelist and
// analysisRequired on whatever it finds; openRisk stamps the CALLER's companyId
// onto a risk pointing at an arbitrary moduleId (riskProperties/create.js:18-20).
// A published CSAF document carries real tokens for its company's modules, so a
// user with the removal role in their own company could import another company's
// document and delete it with unmuteVulnerabilities: true to write into that
// tenant's module.
// ---------------------------------------------------------------------------

describe('AC29: the decoded ids are scoped to the caller\'s company before any write', () => {
  it('skips both actions for a foreign module while the owned one still runs', async () => {
    const codec = makeCodec();
    const world = await runRemoval([
      codec.encodeProductId('m1'),
      mintToken('mForeign')
    ]);
    expect(world.unmuted).toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
    expect(world.risks).toEqual([{user: 'u-1', cveKey: 'CVE-2026-1234', moduleId: 'm1'}]);
  });

  it('a document made only of foreign tokens performs no write at all', async () => {
    const world = await runRemoval([
      mintToken('mForeign'),
      mintToken('some-other-tenants-module')
    ]);
    expect(world.unmuted).toEqual([]);
    expect(world.risks).toEqual([]);
  });

  it('an id that exists in no company at all is dropped too', async () => {
    const world = await runRemoval([mintToken('no-such-module-anywhere')]);
    expect(world.unmuted).toEqual([]);
    expect(world.risks).toEqual([]);
  });

  it('scopes the lookup to the CALLER\'s company, never to anything in the document', async () => {
    // Same document, a caller from the OTHER company: the ids that were actionable
    // above must now all be refused, and the one that was refused becomes actionable.
    const codec = makeCodec();
    const world = {unmuted: [], risks: []};
    await runRemoveActions(
      {unmuteVulnerabilities: true, openRisks: true},
      csafDocument([codec.encodeProductId('m1'), mintToken('mForeign')]),
      {_id: 'u-2', profile: {companyId: OTHER_CO}},
      require('underscore'),
      codec.decodeProductId,
      async (cveKey, moduleId) => world.unmuted.push({cveKey, moduleId}),
      async (user, cveKey, moduleId) => world.risks.push({cveKey, moduleId}),
      async (ids, companyId) => new Set(ids.filter((id) => MODULE_OWNERSHIP[id] === companyId))
    );
    expect(world.unmuted).toEqual([{cveKey: 'CVE-2026-1234', moduleId: 'mForeign'}]);
  });

  it('asks the database once for the whole document, not once per token', async () => {
    const codec = makeCodec();
    const world = await runRemoval([
      codec.encodeProductId('m1'), codec.encodeProductId('m2'),
      mintToken('mForeign')
    ]);
    expect(world.ownershipCalls).toHaveLength(1);
    expect(world.ownershipCalls[0].companyId).toBe(CO);
    expect(world.ownershipCalls[0].ids.sort()).toEqual(['m1', 'm2', 'mForeign']);
  });

  it('a PRODUCT id of the caller\'s own company does not pass the module check', async () => {
    // remove.js writes into Modules; the module-only ownership variant is the one
    // it must use, or a product id would open a risk against a non-existent module.
    expect(OWNERSHIP.p1).toBe(CO);
    const world = await runRemoval([mintToken('p1')]);
    expect(world.unmuted).toEqual([]);
    expect(world.risks).toEqual([]);
  });

  it('the removal itself is unaffected - the block resolves normally', async () => {
    await expect(runRemoval([mintToken('mForeign')])).resolves.toBeDefined();
  });
});

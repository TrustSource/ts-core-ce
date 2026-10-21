/* eslint-disable no-undef */
// How much cipher work one CSAF removal can be made to do.
//
// Security review finding 2. `imports/lib/interactors/csaf/remove.js` decodes
// every `product_id` in a document's `vulnerabilities[].product_status` before
// anything is filtered. The document is JSON the CALLER uploaded
// (csaf-import-modal -> csaf/create.js), and neither create.js nor CSAFSchema
// caps its size, so the number of decode calls was bounded only by what fitted in
// a Mongo document - roughly 250,000 tokens at 64 bytes each. Nothing deduped
// first either, so a document repeating ONE token across 500 vulnerabilities paid
// for 500 decrypts of the same string.
//
// remove.js imports Meteor and cannot be required under Jest, so the decoder is
// lifted out of the source and executed here - the technique
// test_api/specs/csaf-tenant-scope.unit.spec.js uses for the removal block
// itself. That spec covers WHICH ids reach the write; this one covers how much
// work getting there is allowed to cost.
const fs = require('fs');
const path = require('path');

const REMOVE_JS = 'imports/lib/interactors/csaf/remove.js';

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

function sliceBalanced(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `${REMOVE_JS} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing ${marker} from ${REMOVE_JS}`);
}

const REMOVE_SRC = stripComments(readRepo(REMOVE_JS));

const CAP_SRC = (function () {
  const match = REMOVE_SRC.match(/^const MAX_DECODED_PRODUCT_IDS = \d+;$/m);
  if (!match) {
    throw new Error(
      `${REMOVE_JS} no longer declares MAX_DECODED_PRODUCT_IDS; re-anchor this spec`);
  }
  return match[0];
})();

const DECODER_SRC = sliceBalanced(REMOVE_SRC, 'function productIdDecoder(');

const buildDecoder = new Function('decodeProductId', 'console',
  `${CAP_SRC}\n${DECODER_SRC}\nreturn {productIdDecoder, MAX_DECODED_PRODUCT_IDS};`);

const MAX = buildDecoder(() => undefined, {warn() {}}).MAX_DECODED_PRODUCT_IDS;

/**
 * A decoder over a recording codec, so "how many decrypts did that cost?" is an
 * assertion rather than an inspection.
 */
function makeDecoder() {
  const calls = [];
  const warnings = [];
  const {productIdDecoder} = buildDecoder(
    (token) => {
      calls.push(token);
      // Anything shaped like a token resolves to a matching id; everything else
      // is undecodable, exactly as the real codec behaves.
      return /^tok-/.test(token) ? token.replace('tok-', 'm-') : undefined;
    },
    {warn: (...args) => warnings.push(args.join(' '))});
  return {decode: productIdDecoder(), calls, warnings};
}

// ---------------------------------------------------------------------------

describe('the decoder under test really came out of remove.js', () => {
  it('lifted the cap and the factory, and remove.js uses them on the decode path', () => {
    expect(DECODER_SRC).toContain('function productIdDecoder(');
    expect(DECODER_SRC).toContain('decodeProductId(');
    // The call site: the removal block must go through the per-document decoder,
    // not straight to the codec, or none of this bounds anything.
    expect(REMOVE_SRC).toMatch(/const decodeToken = productIdDecoder\(\)/);
    expect(REMOVE_SRC).toMatch(/\.map\(productId => decodeToken\(productId\)\)/);
    expect(REMOVE_SRC).not.toMatch(/\.map\(productId => decodeProductId\(productId\)\)/);
  });

  it('the cap is generous enough for any real document', () => {
    // A vulnerability report covers the modules of one project. The cap has to
    // sit far above that, because silently skipping a legitimate unmute is a
    // worse failure than the work it bounds.
    expect(MAX).toBeGreaterThanOrEqual(10000);
  });
});

describe('finding 2: a repeated token costs one decode, not one per occurrence', () => {
  it('decodes each DISTINCT token exactly once', () => {
    const {decode, calls} = makeDecoder();
    for (let i = 0; i < 500; i++) {
      expect(decode('tok-1')).toBe('m-1');
      expect(decode('tok-2')).toBe('m-2');
    }
    expect(calls).toEqual(['tok-1', 'tok-2']);
  });

  it('caches the undecodable ones too - a forged token repeated 500 times costs one attempt', () => {
    // The likelier shape of an abusive document: tokens that never resolve, so a
    // cache that only remembered successes would still pay per occurrence.
    const {decode, calls} = makeDecoder();
    for (let i = 0; i < 500; i++) {
      expect(decode('garbage')).toBeUndefined();
    }
    expect(calls).toEqual(['garbage']);
  });

  it('each document gets its own cache - nothing leaks between removals', () => {
    const {decode: first, calls} = makeDecoder();
    first('tok-1');
    expect(calls.length).toBe(1);
    // A second decoder from the same factory starts empty.
    const {decode: second, calls: secondCalls} = makeDecoder();
    second('tok-1');
    expect(secondCalls).toEqual(['tok-1']);
  });
});

describe('finding 2: the number of distinct tokens decoded is capped', () => {
  it('stops decoding past the cap and reports the rest as undecodable', () => {
    const {decode, calls} = makeDecoder();
    for (let i = 0; i < MAX; i++) {
      expect(decode(`tok-${i}`)).toBe(`m-${i}`);
    }
    expect(calls.length).toBe(MAX);
    expect(decode('tok-over-the-line')).toBeUndefined();
    expect(calls.length).toBe(MAX);
  });

  it('a token already decoded still resolves after the cap is reached', () => {
    // The cap bounds new work, not the answers already paid for - otherwise a
    // large document would start dropping unmutes it had already resolved.
    const {decode} = makeDecoder();
    for (let i = 0; i < MAX; i++) {
      decode(`tok-${i}`);
    }
    expect(decode('tok-past-cap')).toBeUndefined();
    expect(decode('tok-0')).toBe('m-0');
  });

  it('truncation is logged once, not silently and not per token', () => {
    const {decode, warnings} = makeDecoder();
    for (let i = 0; i < MAX + 50; i++) {
      decode(`tok-${i}`);
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain(String(MAX));
  });

  it('NON-VACUITY: an ordinary document is nowhere near the cap and logs nothing', () => {
    const {decode, calls, warnings} = makeDecoder();
    for (let i = 0; i < 300; i++) {
      expect(decode(`tok-${i}`)).toBe(`m-${i}`);
    }
    expect(calls.length).toBe(300);
    expect(warnings).toEqual([]);
  });
});

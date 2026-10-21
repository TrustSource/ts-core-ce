/* eslint-disable no-undef */
// Request log of public release / CSAF keys: capped list plus a running total.
const fs = require('fs');
const path = require('path');
const {
  REQUEST_LOG_LIMIT,
  requestLogModifier,
  requestCount
} = require('../../imports/lib/companies/publicKeyRequests');

describe('requestLogModifier', () => {
  it('pushes the address onto the positional key, keeping only the newest entries', () => {
    expect(requestLogModifier('publicReleaseKeys', '10.0.0.1')).toEqual({
      $push: {'publicReleaseKeys.$.requests': {$each: ['10.0.0.1'], $slice: -REQUEST_LOG_LIMIT}},
      $inc: {'publicReleaseKeys.$.requestCount': 1}
    });
  });

  it('caps the list at 100 entries', () => {
    expect(REQUEST_LOG_LIMIT).toBe(100);
  });
});

describe('requestCount', () => {
  it('uses the running total once it exists', () => {
    expect(requestCount({requests: new Array(100).fill('x'), requestCount: 250})).toBe(250);
  });

  it('falls back to the list for keys written before the total existed', () => {
    expect(requestCount({requests: ['a', 'b', 'c']})).toBe(3);
  });

  it('returns 0 for a missing key or empty log', () => {
    expect(requestCount(undefined)).toBe(0);
    expect(requestCount({})).toBe(0);
  });
});

describe('saveRequest methods', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../imports/server/collections/companies.js'), 'utf8');

  it('never rewrite the whole key array or push without a cap', () => {
    expect(src).not.toMatch(/item\.requests\.push\(/);
    expect(src).not.toMatch(/\$push: \{'publicCsafKeys\.\$\.requests'/);
    // One shared helper for the three release-key feeds, one for the CSAF feed.
    expect(src.match(/requestLogModifier\('/g)).toHaveLength(2);
    expect(src.match(/await saveReleaseKeyRequest\(/g)).toHaveLength(3);
  });
});

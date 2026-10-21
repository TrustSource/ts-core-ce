// Request log of a public release or CSAF key. Every feed request adds the caller's
// address; the list keeps only the newest REQUEST_LOG_LIMIT entries so the company
// document cannot grow without bound, and `requestCount` keeps the full total.
//
// CommonJS (no meteor/* imports) so Jest can require it directly.

const REQUEST_LOG_LIMIT = 100;

// Mongo modifier recording one request on the positional element (`$`) of `field`.
function requestLogModifier(field, address) {
  return {
    $push: {[field + '.$.requests']: {$each: [address], $slice: -REQUEST_LOG_LIMIT}},
    $inc: {[field + '.$.requestCount']: 1}
  };
}

// Total requests for display. Keys written before the counter existed only have
// the list, so take whichever is larger.
function requestCount(key) {
  if (!key) {
    return 0;
  }
  const listed = Array.isArray(key.requests) ? key.requests.length : 0;
  const counted = typeof key.requestCount === 'number' ? key.requestCount : 0;
  return Math.max(listed, counted);
}

module.exports = {REQUEST_LOG_LIMIT, requestLogModifier, requestCount};

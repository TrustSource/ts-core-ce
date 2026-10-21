/* eslint-disable no-undef */
// Opt-in request bounds on httpCall (imports/lib/httpFetch.js), for a caller that fetches a
// URL somebody else chose (the company logo is one: every sign-up is an account admin who
// can set it):
//   timeoutMs - the request, body included, rejects with code ETIMEDOUT once it runs out;
//   maxBytes  - a larger Content-Length rejects with code RESPONSE_TOO_LARGE before the body
//               is read, and a body without one is streamed and cut off one byte past the cap.
// Neither applies unless passed, so every other caller keeps the original fetch call.
//
// Real WHATWG Response / ReadableStream objects stand in for the network, so the body is
// consumed the way the server consumes it; node:dns/promises is mocked for the egress guard.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn()
}));
const dns = require('node:dns/promises');
const {httpCall} = require('../../imports/lib/httpFetch');

const URL = 'https://logo.example.test/logo.png';

function abortable(init, executor) {
  return new Promise((resolve, reject) => {
    if (init.signal) {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), {name: 'AbortError'})));
    }
    executor(resolve, reject);
  });
}

// A body of `chunkSize` bytes per pull that records what happened to it. It ends after 2000
// chunks only so that a reader without a cap fails the assertions instead of exhausting the heap.
function endlessBody(chunkSize) {
  const state = {pulls: 0, cancelled: false};
  const stream = new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      if (state.pulls > 2000) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize));
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return {stream, state};
}

beforeEach(() => {
  dns.lookup.mockReset();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('httpCall without limits', () => {
  it('calls fetch exactly as before: no signal, whole body read', async () => {
    global.fetch.mockResolvedValueOnce(new Response('hello', {status: 200, headers: {'content-type': 'text/plain'}}));
    const result = await httpCall('GET', URL);
    expect(global.fetch).toHaveBeenCalledWith(URL, {method: 'GET', headers: {}});
    expect(result.content).toBe('hello');
  });
});

describe('httpCall timeoutMs', () => {
  it('aborts the fetch and rejects with ETIMEDOUT', async () => {
    let signal;
    global.fetch.mockImplementationOnce((url, init) => {
      signal = init.signal;
      return abortable(init, () => {});
    });
    await expect(httpCall('GET', URL, {timeoutMs: 30})).rejects.toMatchObject({code: 'ETIMEDOUT'});
    expect(signal.aborted).toBe(true);
  });

  it('rejects on time even when the fetch ignores the abort', async () => {
    global.fetch.mockImplementationOnce(() => new Promise(() => {}));
    await expect(httpCall('GET', URL, {timeoutMs: 30})).rejects.toMatchObject({code: 'ETIMEDOUT'});
  });

  it('covers a body that stalls after the headers arrived', async () => {
    const stalled = new ReadableStream({pull() { return new Promise(() => {}); }});
    global.fetch.mockResolvedValueOnce(new Response(stalled, {status: 200}));
    await expect(httpCall('GET', URL, {timeoutMs: 30, npmRequestOptions: {encoding: null}}))
      .rejects.toMatchObject({code: 'ETIMEDOUT'});
  });

  it('answers normally inside the time and never aborts afterwards', async () => {
    let signal;
    global.fetch.mockImplementationOnce(async (url, init) => {
      signal = init.signal;
      return new Response('{"ok":true}', {status: 200, headers: {'content-type': 'application/json'}});
    });
    const result = await httpCall('GET', URL, {timeoutMs: 30});
    expect(result.data).toEqual({ok: true});
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(signal.aborted).toBe(false);
  });
});

describe('httpCall maxBytes', () => {
  it('refuses a declared Content-Length above the cap without reading the body', async () => {
    const {stream, state} = endlessBody(64);
    let signal;
    global.fetch.mockImplementationOnce(async (url, init) => {
      signal = init.signal;
      return new Response(stream, {status: 200, headers: {'content-length': '2048'}});
    });
    await expect(httpCall('GET', URL, {maxBytes: 1024, npmRequestOptions: {encoding: null}}))
      .rejects.toMatchObject({code: 'RESPONSE_TOO_LARGE'});
    expect(signal.aborted).toBe(true);
    // A ReadableStream pulls once to fill its queue when it is created; nothing is read after that.
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it('stops reading an undeclared body one chunk past the cap', async () => {
    const {stream, state} = endlessBody(100);
    let signal;
    global.fetch.mockImplementationOnce(async (url, init) => {
      signal = init.signal;
      return new Response(stream, {status: 200});
    });
    await expect(httpCall('GET', URL, {maxBytes: 1000, npmRequestOptions: {encoding: null}}))
      .rejects.toMatchObject({code: 'RESPONSE_TOO_LARGE'});
    expect(signal.aborted).toBe(true);
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThanOrEqual(13);
  });

  it('accepts a body of exactly the cap, as bytes or as text', async () => {
    const bytes = Buffer.alloc(1000, 0x61);
    global.fetch.mockResolvedValueOnce(new Response(bytes, {status: 200}));
    const binary = await httpCall('GET', URL, {maxBytes: 1000, npmRequestOptions: {encoding: null}});
    expect(Buffer.isBuffer(binary.content)).toBe(true);
    expect(binary.content.equals(bytes)).toBe(true);

    global.fetch.mockResolvedValueOnce(new Response(bytes, {status: 200, headers: {'content-type': 'text/plain'}}));
    const text = await httpCall('GET', URL, {maxBytes: 1000});
    expect(text.content).toBe('a'.repeat(1000));
  });

  it('still reports an HTTP error status', async () => {
    global.fetch.mockResolvedValueOnce(new Response('missing', {status: 404, statusText: 'Not Found'}));
    await expect(httpCall('GET', URL, {maxBytes: 1000})).rejects.toMatchObject({message: '404 Not Found'});
  });
});

describe('httpCall limits with validateEgress', () => {
  it('still refuses an internal target before any fetch', async () => {
    dns.lookup.mockResolvedValue([{address: '169.254.169.254', family: 4}]);
    await expect(httpCall('GET', URL, {validateEgress: true, timeoutMs: 1000, maxBytes: 1000}))
      .rejects.toMatchObject({code: 'SSRF_BLOCKED'});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('bounds the final hop of a public redirect chain', async () => {
    dns.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}]);
    const {stream} = endlessBody(100);
    global.fetch
      .mockResolvedValueOnce(new Response(null, {status: 302, headers: {location: 'https://cdn.example.test/logo.png'}}))
      .mockResolvedValueOnce(new Response(stream, {status: 200}));
    await expect(httpCall('GET', URL, {validateEgress: true, maxBytes: 1000, npmRequestOptions: {encoding: null}}))
      .rejects.toMatchObject({code: 'RESPONSE_TOO_LARGE'});
    expect(global.fetch).toHaveBeenCalledTimes(2);
    global.fetch.mock.calls.forEach(([, init]) => expect(init.signal).toBeDefined());
  });
});

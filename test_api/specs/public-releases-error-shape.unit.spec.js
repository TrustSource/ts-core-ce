/* eslint-disable no-undef */
// The public release endpoints must not answer a failure with an internal error
// message, and must not answer it with 200.
//
// Security review finding 4. imports/lib/converter/vex.js threw
// `'VEX: missing product_id for module ' + module._id`, and
// imports/server/rest-api/releases.js handed that straight to the wire with
// `response.end(JSON.stringify(error.message))` and no status code - on
// /api/v2/compliance/releases/:id/csaf, an UNAUTHENTICATED route. A raw module `_id` on that
// route is the exact thing this whole change exists to keep out of it, and a
// failure served as "200 OK" is what 3.3.20 fixed for the old BoM and Notice
// endpoints but not for these ones.
//
// The handlers are module-private, so they are LIFTED out of the source and
// executed here, the technique test_api/specs/csaf-product-id.unit.spec.js uses
// for vex.js. Every slice asserts it matched, so a rename fails loudly rather
// than silently testing nothing.
const fs = require('fs');
const path = require('path');

const RELEASES_JS = 'imports/server/rest-api/releases.js';
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

function sliceBalanced(source, marker, fileLabel) {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `${fileLabel} no longer contains \`${marker}\`; re-anchor this spec, never delete it`);
  }
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing ${marker} from ${fileLabel}`);
}

const RELEASES_SRC = stripComments(readRepo(RELEASES_JS));
const VEX_SRC = stripComments(readRepo(VEX_JS));

// The three GET handlers plus the two helpers they lean on, built into one scope
// so each handler runs against the real notFound/errorStatus it ships with.
const HANDLERS = ['handleGetSbom', 'handleGetNotice', 'handleGetVex'];
const HANDLER_SRC = HANDLERS
  .map((name) => sliceBalanced(RELEASES_SRC, `async function ${name}(`, RELEASES_JS))
  .join('\n');
const HELPER_SRC = ['function notFound(', 'function failed(']
  .map((marker) => sliceBalanced(RELEASES_SRC, marker, RELEASES_JS))
  .join('\n');
// RestApi.errorStatus is the shared status rule (imports/server/rest-api/RestApi.js).
// Lifted from there rather than restated, so this spec exercises the real rule.
const ERROR_STATUS_SRC = sliceBalanced(
  stripComments(readRepo('imports/server/rest-api/RestApi.js')),
  'function errorStatus(', 'imports/server/rest-api/RestApi.js');
// The fixed body is a module constant, not a helper, so it is lifted separately.
const FAILED_BODY_SRC = (function () {
  const match = RELEASES_SRC.match(/^const FAILED_BODY = .*$/m);
  if (!match) {
    throw new Error(
      `${RELEASES_JS} no longer declares FAILED_BODY; re-anchor this spec, never delete it`);
  }
  return match[0];
})();

const buildHandlers = new Function('Meteor', 'console',
  `${ERROR_STATUS_SRC}\nconst RestApi = {errorStatus};\n`
  + `${FAILED_BODY_SRC}\n${HELPER_SRC}\n${HANDLER_SRC}\nreturn {${HANDLERS.join(', ')}};`);

// A response recorder in the shape Iron Router hands the route: statusCode
// pre-set to 200 by getResponse (releases.js:43), which is the whole reason a
// catch that only writes a body reports a failure as a success.
function makeResponse() {
  return {statusCode: 200, body: undefined, end(value) { this.body = value; }};
}

const REQUEST = {connection: {remoteAddress: '203.0.113.7'}};
const PARAMS = {id: 'public-release-key-1'};

const SECRET_ID = 'nA7ZqKxLmP3vTbW9c';   // a module _id, Random.id() shape

/**
 * @param throwFrom which Meteor method should blow up
 * @param error     what it should throw
 */
function runHandler(name, throwFrom, error) {
  const logged = [];
  const meteor = {
    callAsync: async (methodName) => {
      if (methodName === throwFrom) {
        throw error;
      }
      if (methodName === 'publicBoMKey.one' || methodName === 'publicNoticeKey.one'
        || methodName === 'publicReleaseKey.one') {
        return {releaseId: 'rel-1'};
      }
      return {ok: true};
    }
  };
  const handlers = buildHandlers(meteor, {
    error: (...args) => logged.push(args.join(' ')),
    log: (...args) => logged.push(args.join(' '))
  });
  const response = makeResponse();
  return handlers[name](REQUEST, PARAMS, response, false)
    .then(() => ({response, logged}));
}

// ---------------------------------------------------------------------------

describe('the lift really loaded the shipped handlers', () => {
  it('found all three GET handlers and every helper they lean on', () => {
    HANDLERS.forEach((name) => expect(HANDLER_SRC).toContain(`async function ${name}(`));
    expect(HELPER_SRC).toContain('function failed(');
    expect(HELPER_SRC).toContain('function notFound(');
    expect(ERROR_STATUS_SRC).toContain('function errorStatus(');
    expect(typeof buildHandlers({}, {}).handleGetVex).toBe('function');
  });

  it('the status rule is the shared one, not a private copy', () => {
    expect(RELEASES_SRC).not.toContain('function errorStatus(');
    expect(RELEASES_SRC).toContain('RestApi.errorStatus(');
  });
});

describe('finding 4: a generation failure never puts an internal message on the wire', () => {
  // The exact shape the VEX generator throws when a product_id is missing.
  const GENERATION_ERROR = new Error('VEX: missing product_id for module ' + SECRET_ID);

  it.each([
    ['handleGetSbom', 'publicBoMKey.getFile'],
    ['handleGetNotice', 'publicNoticeKey.getFile'],
    ['handleGetVex', 'publicVexKey.getFile']
  ])('%s does not echo the error message', async (handler, failing) => {
    const {response} = await runHandler(handler, failing, GENERATION_ERROR);
    expect(response.body).not.toContain(SECRET_ID);
    expect(response.body).not.toContain('missing product_id');
    expect(response.body).not.toContain('VEX:');
  });

  it.each([
    ['handleGetSbom', 'publicBoMKey.getFile'],
    ['handleGetNotice', 'publicNoticeKey.getFile'],
    ['handleGetVex', 'publicVexKey.getFile']
  ])('%s answers with a non-200 status', async (handler, failing) => {
    const {response} = await runHandler(handler, failing, GENERATION_ERROR);
    expect(response.statusCode).not.toBe(200);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ['handleGetSbom', 'publicBoMKey.one'],
    ['handleGetNotice', 'publicNoticeKey.one'],
    ['handleGetVex', 'publicReleaseKey.one']
  ])('%s: the OUTER catch is covered too, not just the inner one', async (handler, failing) => {
    // Both catches wrote the message; a fix applied to only one of them would
    // still leak through the lookup path.
    const {response} = await runHandler(handler, failing, GENERATION_ERROR);
    expect(response.body).not.toContain(SECRET_ID);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('carries a Meteor.Error code through as the status, as 3.3.20 established', async () => {
    const notFoundError = Object.assign(new Error('Resource not found'), {error: 404});
    const {response} = await runHandler('handleGetVex', 'publicReleaseKey.one', notFoundError);
    expect(response.statusCode).toBe(404);
  });

  it('a failure with no usable code is a 500, not a 404 guess', async () => {
    const {response} = await runHandler('handleGetVex', 'publicVexKey.getFile', GENERATION_ERROR);
    expect(response.statusCode).toBe(500);
  });

  it('the real message is logged server-side, so dropping it costs no diagnosis', async () => {
    const {logged} = await runHandler('handleGetVex', 'publicVexKey.getFile', GENERATION_ERROR);
    expect(logged.join('\n')).toContain('missing product_id');
  });

  it('NON-VACUITY: the success path is untouched - 200 and the document body', async () => {
    const {response} = await runHandler('handleGetVex', 'nothing-throws', new Error('unused'));
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(JSON.stringify({ok: true}));
  });
});

describe('finding 4: the thrown message carries no module _id in the first place', () => {
  // Belt and braces. releases.js is the route that echoed it, but the message is
  // built in vex.js, which is client-bundled and reachable from other callers.
  it('vex.js never interpolates a module _id into the missing-product_id error', () => {
    const throws = VEX_SRC.match(/throw new Error\('VEX: missing product_id[^;]*;/g);
    expect(throws).not.toBeNull();
    expect(throws.length).toBe(2);
    throws.forEach((statement) => {
      // A bare string literal and nothing else: no concatenation, so no value of
      // any kind can be appended to it.
      expect(statement).toBe("throw new Error('VEX: missing product_id for module');");
    });
  });

  it('NON-VACUITY: the guard that throws it is still there', () => {
    expect(VEX_SRC).toContain('VEX: missing product_id for module');
    expect(VEX_SRC).toContain('VEX: productIds map is required');
  });
});

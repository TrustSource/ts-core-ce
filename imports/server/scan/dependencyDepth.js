// How deeply a submitted scan may nest its dependencies, and how that is checked.
//
// A chain deeper than Mongo can store used to fail at Scans.insertAsync, after the request
// had already paid for full schema validation and had created a module. The caller got
// "500 Internal Server Error" for a client-side problem:
//
//   MongoServerError: cannot insert document because it exceeds 180 levels of nesting
//   MongoServerError: BSONObj exceeds maximum nested object depth in element with field
//                     name 'documents.0.dependencies.0.dependencies.0...'
//
// The real ceiling is Mongo's 180 BSON levels, not 100: every dependency level costs two of
// them (the `dependencies` array plus the object inside it), so 89 levels x 2 plus the scan
// wrapper reaches 180. Measured against a running server on 2026-09-04: depth 89 inserts,
// depth 90 does not.
//
// The published limit is set BELOW that ceiling but well ABOVE what any real payload uses,
// and deliberately above the importers' MAX_DEPENDENCY_NESTING (40). Lowering it to 40 would
// newly reject payloads that succeed today; the importers re-parent their overflow, which is
// their business - the native API must not silently restructure what a client sent, so it
// rejects instead.
//
// THE DEPENDENCY CHAIN IS NOT THE ONLY WAY DOWN. The first version of this guard walked
// `body.dependencies` and nothing else, so nesting under any other key still reached
// SimpleSchema.clean, whose MongoObject walk is recursive and stops only at blackbox keys.
// Both doors were confirmed open against a running server on 2026-09-04:
//
//   junk depth 2000 under an unknown top-level key (12 KB)  -> 500 "Maximum call stack
//                                                              size exceeded"
//   `meta` (a blackbox field) nested 500 inside a dependency -> 500 "BSONObj exceeds
//                                                              maximum nested object depth"
//
// So there are two limits, checked in this order:
//
//   MAX_SCAN_DEPENDENCY_DEPTH  the published, dependency-shaped limit. Checked first so a
//                              too-deep chain keeps naming the offending dependency.
//   MAX_SCAN_BODY_DEPTH        a backstop over the WHOLE parsed body, for every other way
//                              of nesting. Derived, not chosen: see below.
//
// Meteor-free CommonJS, same as ./rootDependency.js and ./skippedDependencies.js, so plain
// Jest can require it (`yarn meteor-test` does not boot on this checkout).

const {truncateText, MAX_ECHOED_TEXT} = require('./textLimits');

/** The deepest dependency chain POST /api/v2/core/scans accepts. Depth is 1-based. */
const MAX_SCAN_DEPENDENCY_DEPTH = 80;

/** The deepest chain Mongo will actually store, measured. Kept as the guard's headroom. */
const MAX_STORABLE_DEPENDENCY_DEPTH = 89;

/**
 * The deepest ANY value in a submitted body may be nested. Generic depth: the body object
 * is level 0, each object or array inside it one more.
 *
 * Derived from the same 180-level BSON ceiling as the constant above. The insert command
 * wraps the document in `documents.0`, which costs two levels, so nothing nested deeper
 * than generic level 178 can be stored at all - past that the request is choosing between
 * an opaque Mongo 500 and being silently filtered away by the schema. 176 keeps two levels
 * of margin.
 *
 * It has to sit ABOVE the deepest legal payload, and it does: one dependency level costs
 * two generic levels (`dependencies` array + the node), so a chain at the published limit
 * of 80 reaches generic level 160, plus a few for the node's own `meta`/`versions`. 176 is
 * therefore unreachable by any dependency tree the dependency guard lets through, and
 * around fifteen times deeper than the importers' MAX_DEPENDENCY_NESTING of 40.
 */
const MAX_SCAN_BODY_DEPTH = 176;

/** Path segments named in a general-nesting rejection before it gives up and elides. */
const MAX_PATH_SEGMENTS = 12;

/** Longest single path segment echoed back; keys come from the payload. */
const MAX_PATH_SEGMENT = 64;

/**
 * The first node deeper than `max`, in depth-first order.
 *
 * ITERATIVE ON PURPOSE. A recursive walk would overflow the stack on exactly the input this
 * function exists to reject - a 10 000-level chain - turning the intended 400 back into a
 * 500. The explicit stack holds one frame per level, and the deepest possible payload is
 * bounded by the 5 MB body limit.
 *
 * @param {Array} dependencies a scan's top-level dependency list; anything else is "no
 *   violation", because the schema is what reports a malformed list
 * @param {Number} [max] the limit, defaults to MAX_SCAN_DEPENDENCY_DEPTH
 * @returns {Object|null} {depth, name?, key?, purl?} for the offending node, or null
 */
function findDepthViolation(dependencies, max) {
  if (!Array.isArray(dependencies) || !dependencies.length) return null;
  const limit = typeof max === 'number' ? max : MAX_SCAN_DEPENDENCY_DEPTH;
  const stack = [];
  for (let i = dependencies.length - 1; i >= 0; i--) {
    stack.push({node: dependencies[i], depth: 1});
  }
  while (stack.length) {
    const frame = stack.pop();
    const node = frame.node;
    if (!node || typeof node !== 'object') continue;
    if (frame.depth > limit) {
      // Truncated HERE rather than at each of the three places the response repeats the
      // identifier: `name` has no `max` in ApiDependencySchema, and a 2 MB one produced a
      // response several megabytes long.
      const violation = {depth: frame.depth};
      if (typeof node.name === 'string') violation.name = truncateText(node.name);
      if (typeof node.key === 'string') violation.key = truncateText(node.key);
      if (typeof node.purl === 'string') violation.purl = truncateText(node.purl);
      return violation;
    }
    const children = node.dependencies;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({node: children[i], depth: frame.depth + 1});
      }
    }
  }
  return null;
}

/**
 * How the rejection reads to the client. Kept here so the message and the limit cannot
 * drift apart.
 *
 * @param {Object} violation what findDepthViolation returned
 * @param {Number} [max] the limit that was applied
 * @returns {String} a description naming the limit and the offending node
 */
function describeDepthViolation(violation, max) {
  const limit = typeof max === 'number' ? max : MAX_SCAN_DEPENDENCY_DEPTH;
  const offender = violation.key || violation.purl || violation.name || 'unnamed dependency';
  // findDepthViolation already caps these; capping again keeps the guarantee with a caller
  // that built the violation itself.
  return 'Dependency nesting exceeds the maximum of ' + limit + ' levels: "' +
    truncateText(offender) + '" is nested at level ' + violation.depth;
}

/**
 * Where a frame sits, as a dotted path, built only once a violation is found.
 *
 * Frames carry a parent pointer rather than a running string: the walk pushes one frame per
 * object in the body, and concatenating a path onto every one of them would allocate a
 * string per node of a 5 MB payload for a path that is almost never read.
 *
 * The chain is walked leaf-to-root and then reversed, because it is the ROOT end that says
 * which field the client got wrong - the deep end of an over-nested path is the same repeated
 * key all the way down. Collecting the whole chain first is affordable: it is bounded by the
 * limit that was just exceeded.
 *
 * @param {Object} frame the offending frame
 * @returns {String} e.g. "dependencies.0.meta.a.a...", capped in segments and total length
 */
function framePath(frame) {
  const segments = [];
  let current = frame;
  while (current && current.key !== null) {
    segments.push(truncateText(current.key, MAX_PATH_SEGMENT));
    current = current.parent;
  }
  segments.reverse();
  const elided = segments.length > MAX_PATH_SEGMENTS;
  const path = segments.slice(0, MAX_PATH_SEGMENTS).join('.') + (elided ? '...' : '');
  return truncateText(path, MAX_ECHOED_TEXT);
}

/**
 * The first value in a whole request body nested deeper than `max`, in depth-first order.
 *
 * The general backstop behind findDepthViolation: a body can nest under any key, and
 * everything downstream of this point - cleanAndValidateDependency, SimpleSchema.clean's
 * MongoObject walk, the BSON encoder - recurses. Iterative for exactly the same reason
 * findDepthViolation is: the input this exists to reject is the input a recursive walk
 * dies on.
 *
 * Only object and array values are pushed, so a string of any length costs one comparison.
 *
 * @param {Object} body the parsed request body
 * @param {Number} [max] the limit, defaults to MAX_SCAN_BODY_DEPTH
 * @returns {Object|null} {depth, path} for the offending value, or null
 */
function findBodyDepthViolation(body, max) {
  if (!body || typeof body !== 'object') return null;
  const limit = typeof max === 'number' ? max : MAX_SCAN_BODY_DEPTH;
  const stack = [{value: body, depth: 0, key: null, parent: null}];
  while (stack.length) {
    const frame = stack.pop();
    if (frame.depth > limit) {
      return {depth: frame.depth, path: framePath(frame)};
    }
    const value = frame.value;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        const child = value[i];
        if (child && typeof child === 'object') {
          stack.push({value: child, depth: frame.depth + 1, key: String(i), parent: frame});
        }
      }
    } else {
      const keys = Object.keys(value);
      for (let i = keys.length - 1; i >= 0; i--) {
        const child = value[keys[i]];
        if (child && typeof child === 'object') {
          stack.push({value: child, depth: frame.depth + 1, key: keys[i], parent: frame});
        }
      }
    }
  }
  return null;
}

/**
 * How the general rejection reads to the client. Deliberately worded differently from
 * describeDepthViolation: a client that hits this one is not looking at its dependency
 * tree, it is looking at some other part of what it sent.
 *
 * @param {Object} violation what findBodyDepthViolation returned
 * @param {Number} [max] the limit that was applied
 * @returns {String} a description naming the limit and where the nesting is
 */
function describeBodyDepthViolation(violation, max) {
  const limit = typeof max === 'number' ? max : MAX_SCAN_BODY_DEPTH;
  const where = violation && violation.path
    ? '"' + truncateText(violation.path) + '"'
    : 'the request body';
  return 'Payload nesting exceeds the maximum of ' + limit + ' levels: ' + where +
    ' is nested at level ' + violation.depth;
}

module.exports = {
  MAX_SCAN_DEPENDENCY_DEPTH,
  MAX_STORABLE_DEPENDENCY_DEPTH,
  MAX_SCAN_BODY_DEPTH,
  findDepthViolation,
  describeDepthViolation,
  findBodyDepthViolation,
  describeBodyDepthViolation
};

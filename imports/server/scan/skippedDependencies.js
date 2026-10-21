// What a processScan run could not do, recorded on the scan instead of lost.
//
// Previously a dependency node with neither `key` nor `purl` threw inside
// handleDependency (`key.toLowerCase()` on undefined) and took the entire run with it: the
// valid siblings never reached the component catalogue, `dependencyCount` was never
// written, no analysis was produced - and the client already held its 201, because
// dependency-level validation only produces a `warning`. The only trace was one console
// line on the server.
//
// The run now isolates each node, and every node it had to give up on lands here. Two
// deliberate shapes:
//
//   - the ENTRY LIST IS CAPPED but the COUNT IS NOT. The largest tree observed in
//     production is ~13 500 nodes, and a payload that is systematically broken would
//     otherwise write a second copy of itself onto the scan document. A hundred entries is
//     enough to see what went wrong; the exact count is what keeps the record honest.
//   - each entry carries the PARENT PATH, because "the node called express" is not locatable
//     in a tree that size, and the path is what the scan/SBOM views already key nodes by.
//
// Everything an entry carries is CAPPED and SUMMARISED, because the scan document is
// published to the tenant's users by Meteor.publish('scanDetail'): the identifiers come
// straight out of the payload and ApiDependencySchema puts no upper bound on them, and the
// failure that produced the entry is recorded as a short stable label rather than as raw
// driver text (an E11000 quotes the conflicting document). The full text stays on the
// server log, where handleDependency already writes it.
//
// Meteor-free CommonJS on purpose, same as ./rootDependency.js: `yarn meteor-test` does not
// boot on this checkout, so logic that must be unit-tested is written so plain Jest can
// require it (see test_api/specs/scan-path-guards.unit.spec.js).

const {truncateText, summariseError} = require('./textLimits');

/** How many entries a single run records before it only counts. */
const SKIPPED_DEPENDENCIES_LIMIT = 100;

/** The node carried nothing to look a component up by. */
const SKIP_NO_IDENTIFIER = 'no usable identifier';

/** Processing the node threw; the error message is kept on the entry. */
const SKIP_PROCESSING_FAILED = 'processing failed';

/**
 * A collector for ONE processScan invocation.
 *
 * It is created per run and threaded down as a parameter rather than kept at module level:
 * Meteor.defer puts many processScan runs on the same event loop and every `await` inside
 * handleDependency is an interleaving point, so a shared accumulator would attribute one
 * tenant's skipped nodes to another tenant's scan. A return value would not do either -
 * the children of a failed node are still walked after its own failure, so the collector
 * has to outlive the call that first writes to it.
 *
 * @param {Number} [limit] entries to keep, defaults to SKIPPED_DEPENDENCIES_LIMIT
 * @returns {{record: Function, count: Function, entries: Function}} the collector
 */
function createSkipCollector(limit) {
  const max = typeof limit === 'number' && limit >= 0 ? limit : SKIPPED_DEPENDENCIES_LIMIT;
  const kept = [];
  let total = 0;

  return {
    /**
     * @param {Object} node the dependency that was skipped (anything non-object is tolerated)
     * @param {String} parentPath the path of the node's parent, as handleDependency builds it
     * @param {String} reason one of the SKIP_* constants
     * @param {Error} [error] the failure, when there was one
     */
    record: function record(node, parentPath, reason, error) {
      total++;
      if (kept.length >= max) return;
      const source = (node && typeof node === 'object') ? node : {};
      // Undefined fields are omitted rather than stored: a scan document has no schema, so
      // an explicit `key: undefined` would be persisted as null and read back as a value.
      const entry = {
        path: truncateText(typeof parentPath === 'string' ? parentPath : '/')
      };
      if (typeof source.name === 'string') entry.name = truncateText(source.name);
      if (typeof source.key === 'string') entry.key = truncateText(source.key);
      if (typeof source.purl === 'string') entry.purl = truncateText(source.purl);
      entry.reason = reason;
      const summary = summariseError(error);
      if (summary) entry.message = summary;
      kept.push(entry);
    },

    /** Every node skipped this run, capped or not. */
    count: function count() {
      return total;
    },

    /** A copy of the kept entries, so a caller cannot grow the record after the fact. */
    entries: function entries() {
      return kept.slice();
    }
  };
}

module.exports = {
  SKIPPED_DEPENDENCIES_LIMIT,
  SKIP_NO_IDENTIFIER,
  SKIP_PROCESSING_FAILED,
  createSkipCollector
};

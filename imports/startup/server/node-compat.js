import util from 'util';

// Silence Node DEP0060: `util._extend` is deprecated. A transitive dependency
// still calls it during startup, which prints a deprecation warning to the
// server console. Point it at `Object.assign`, which is semantically identical
// for the documented two-argument `_extend(target, source)` usage, so the call
// keeps working without emitting the deprecation. Must run before any other
// server module that might trigger the call.
if (typeof util._extend === 'function') {
  util._extend = Object.assign;
}

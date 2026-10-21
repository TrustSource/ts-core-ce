// ---------------------------------------------------------------------------
// One definition of a normalised project name.
//
// The shared name lookup gave every "which project does this name mean" site the same answer, but
// left the NAME itself unnormalised on two of the three write paths, so
// `"  Storefront  "` and `"Storefront"` are two different projects and an ingest
// call naming either one only finds its own spelling. The REST create arm was the
// exception - `cleanAndValidateProject` runs SimpleSchema's `clean`, which trims -
// which is what kept the inconsistency invisible from the API side.
//
// TRIM ONLY. Not case folding, not interior-whitespace collapsing, not Unicode
// normalisation: each of those changes the identity of names that are ALREADY
// STORED, so applying one on the read side would silently re-point live ingest at
// a different project, and applying one on the write side would make a project
// unreachable by the name its owner typed. Trimming is the one transformation
// whose result is what a human meant in every case, and the one SimpleSchema's
// own `clean` already applies on the REST path - so it is also the transformation
// that makes the three write paths AGREE rather than adding a fourth behaviour.
//
// Lives under imports/lib/project/ rather than beside the resolver so that the
// server-only REST layer, the shared interactor layer and imports/server/
// collections can all import the same function.
//
// A non-string answers `undefined` - the same shape as `asString()` in
// imports/lib/security/sanitizeQuery.js - so a caller can tell "nothing usable"
// from "an empty name" and reject it rather than letting it reach a selector.
// ---------------------------------------------------------------------------

/**
 * @param  {*} value            a project name from a request body, a DDP modifier or a form
 * @return {String|undefined}   the trimmed name, or undefined if `value` is not a string
 */
export function normalizeProjectName(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

export default normalizeProjectName;

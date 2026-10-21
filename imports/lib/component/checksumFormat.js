// What a checksum is allowed to look like, declared once.
//
// ApiDependencySchema.checksum enforces this at the REST ingest boundary and
// cleanAndValidateDependency drops a value that fails it. That closes
// the front door only: POST /api/v2/core/scans/:id/reprocess re-runs processScan over the STORED
// scan without re-validating it, so a scan submitted before 3.2.69 still carried its bad
// value into `components.versions[].checksums[]` - a catalogue every tenant reads and every
// SBOM, Notice and CycloneDX export renders as integrity data.
//
// So the same expression also guards the two write sites in processScan. Both importers of
// this module use THIS constant rather than their own copy, because a checksum the API
// accepts and a checksum the catalogue stores must be the same thing by construction.
//
// Hex, 10..128 characters, with an optional `<alg>:` prefix.

export const CHECKSUM_REGEX = /^(?:[a-zA-Z0-9_.-]{2,32}:)?[a-fA-F0-9]{10,128}$/;

/**
 * May this value be written into the shared component catalogue?
 *
 * @param {*} checksum the value a dependency carried
 * @returns {Boolean} true only for a string matching CHECKSUM_REGEX
 */
export function isStorableChecksum(checksum) {
  return typeof checksum === 'string' && CHECKSUM_REGEX.test(checksum);
}

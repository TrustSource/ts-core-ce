// Deriving a license KEY from an SPDX license field.
//
// SPDX `licenseConcluded` / `licenseDeclared` carry a license EXPRESSION, not a plain
// identifier. A bare identifier ("MIT", "Apache-2.0") doubles as the catalog key, but a
// compound expression ("MIT OR Apache-2.0", "GPL-2.0-only WITH Classpath-exception-2.0"),
// NOASSERTION/NONE, or a document-local LicenseRef is not a key - those carry a name only.
// This mirrors the split the CycloneDX reader makes between `license.id` (keyed) and
// `license.expression` (name only), so both importers store comparable license objects.
//
// Plain CommonJS with no Meteor imports so it can be unit-tested directly under Jest.

// A bare SPDX identifier: no whitespace, parentheses or operators.
const SPDX_LICENSE_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

const NOT_A_LICENSE = ['NOASSERTION', 'NONE'];
const LICENSE_REF_PREFIX = 'LicenseRef-';

function spdxLicenseKey(name) {
  if (typeof name !== 'string' || !SPDX_LICENSE_ID.test(name)) return undefined;
  if (NOT_A_LICENSE.indexOf(name) !== -1) return undefined;
  if (name.indexOf(LICENSE_REF_PREFIX) === 0) return undefined;
  return name;
}

module.exports = {spdxLicenseKey};

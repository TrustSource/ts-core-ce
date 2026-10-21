// The package-manager prefixes a component key may carry ("npm:lodash", "maven:org.foo:bar").
// Single source of truth: `Utils.getAllowedPackageTypes` re-exports this list, the API schema
// builds its key/pkgType regexes from it, and key derivation in keyFromPurl.js checks against
// it. Plain CommonJS with no imports so the pure key helpers stay requireable under Jest.
const ALLOWED_PACKAGE_TYPES = [
  'application', 'library',
  'maven', 'mvn', 'npm', 'bower', 'nuget', 'netcore', 'netframework',
  'pip', 'pypi', 'composer', 'php', 'ruby', 'bundler', 'gem',
  'golang', 'go', 'cargo', 'cocoapods', 'swift',
  'docker', 'oci', 'alpine', 'deb', 'rpm',
  'pub', 'hex', 'cran', 'conda', 'nimble', 'ppm',
  'github', 'gitlab', 'generic', 'atm'
];

// Used when a component carries no purl and no caller-supplied package type - the purl spec's
// own "no particular package manager" type, and a valid key prefix.
const DEFAULT_PACKAGE_TYPE = 'generic';

function isAllowedPackageType(type) {
  return typeof type === 'string' && ALLOWED_PACKAGE_TYPES.indexOf(type) !== -1;
}

module.exports = {ALLOWED_PACKAGE_TYPES, DEFAULT_PACKAGE_TYPE, isAllowedPackageType};

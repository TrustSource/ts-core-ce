// Reading a CVSS base score and vector out of a vulnerability's `impact` object.
//
// The vulnerability lake reports scores per CVSS version inside `impact`
// (`cvss2`, `cvss31`, `cvss3`, `cvss4`, each with `baseScore` and
// `vectorString`) and sends no flat score field at all. Callers normalise the
// version keys with Utils.groupedImpactVersions first - `cvss31` becomes
// `cvss3` - and then pick the highest available version, which is the
// precedence encoded here.
//
// CommonJS with no meteor/* imports so Jest can require it directly - the same
// dual-consumption pattern as externalUrl.js.

// Highest CVSS version first: a finding scored under both CVSS 2 and CVSS 3.1
// is reported with its 3.1 score, which is what every call site already did
// inline as `v4 || v3 || v2`.
const VERSIONS = ['cvss4', 'cvss3', 'cvss2'];

function impactField(impact, field) {
  if (!impact) {
    return undefined;
  }
  for (const version of VERSIONS) {
    const entry = impact[version];
    if (entry && entry[field]) {
      return entry[field];
    }
  }
  return undefined;
}

function impactScore(impact) {
  return impactField(impact, 'baseScore');
}

function impactVector(impact) {
  return impactField(impact, 'vectorString');
}

module.exports = {impactScore, impactVector, VERSIONS};

// Vulnerability ids as users type them and as the cache stores them. CommonJS with no
// meteor/* imports, so Jest can require it and client and server can both import it.
//
// OSV ids are upper case (CVE-2021-44228, PYSEC-2021-19, GO-2022-0001) except GitHub
// advisories, whose body is lower case (GHSA-35jh-r3h4-6jhm), and a few feeds that carry
// package names (BIT-apache-2021-41773). So a typed id is looked up as typed AND in its
// canonical spelling, never only upper-cased.
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

function canonicalVulnId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const id = value.trim();
  if (!ID_PATTERN.test(id)) {
    return '';
  }
  if (/^ghsa-/i.test(id)) {
    return 'GHSA-' + id.slice(5).toLowerCase();
  }
  return id.toUpperCase();
}

// The spellings to look a typed id up by: as typed, then canonical. Empty when unusable.
function lookupIds(value) {
  const typed = typeof value === 'string' ? value.trim() : '';
  const canonical = canonicalVulnId(typed);
  if (!canonical) {
    return [];
  }
  return typed === canonical ? [typed] : [typed, canonical];
}

module.exports = {canonicalVulnId, lookupIds};

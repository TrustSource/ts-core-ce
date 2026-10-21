// Single source of truth for the company-document secret-exclusion projection
// (DDP hardening). Every method/publication that returns a company doc to a
// client MUST project these fields OUT - otherwise plaintext REST apiKeys,
// legacy per-company service keys (externalApiKeys), public-resource bearer
// keys (BoM / Notice / Release / CSAF) and integration tokens
// (Jira / TFS / GitHub / LeanIX / Scanoss)
// reach the browser. Centralised here so a NEW secret is added in ONE place and
// cannot drift between the three projection sites (see Security review round 2,
// Finding 2 - publicCsafKeys was missing from every site because the list was
// copied per-call). A `publicCsafKeys[].key` is a CSAF-feed bearer credential
// (resolvable via publicCsafKey.findByKey), so it belongs in the secret set.
//
// CommonJS + no Meteor import so the constant can be unit-tested by the jest
// harness while remaining importable from Meteor ESM code.

// One list, used by every projection site: the `company` publication,
// `getCompanyCurrent` and `getUserCompanies`. There was briefly a second,
// wider set that additionally hid a usage-plan id; that field is gone, so a
// split would now be two identical lists free to drift apart.
const COMPANY_SECRET_EXCLUDE = {
  apiKeys: 0,
  externalApiKeys: 0,
  publicBoMKeys: 0,
  publicNoticeKeys: 0,
  publicReleaseKeys: 0,
  publicCsafKeys: 0,
  'jira.passwd': 0,
  'tfs.token': 0,
  'github.token': 0,
  'leanix.token': 0,
  'scanoss.token': 0
};

module.exports = {COMPANY_SECRET_EXCLUDE};

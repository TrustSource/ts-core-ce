/* eslint-disable no-undef */
// Unit guard for the centralized company secret-exclusion constant (DDP
// hardening). The constant is the single source of truth applied to
// `company`, `getCompanyCurrent` and `getUserCompanies`. If a NEW company secret
// is added it must be added here once;
// this spec asserts the known secret families are all present (including
// publicCsafKeys, the bearer key the per-site lists were dropping), and that the
// module exports exactly one list - a second one would be free to drift.
const {
  COMPANY_SECRET_EXCLUDE
} = require('../../imports/server/security/companySecretFields');

const SECRET_FAMILIES = [
  'apiKeys', 'externalApiKeys', 'publicBoMKeys', 'publicNoticeKeys', 'publicReleaseKeys',
  'publicCsafKeys', 'jira.passwd', 'tfs.token', 'github.token', 'leanix.token', 'scanoss.token'
];

describe('#85 company secret-exclusion constant', () => {
  it('excludes every company secret family', () => {
    SECRET_FAMILIES.forEach((field) => {
      expect(COMPANY_SECRET_EXCLUDE[field]).toBe(0);
    });
  });

  it('explicitly excludes publicCsafKeys (Finding 2 - the dropped bearer key)', () => {
    expect(COMPANY_SECRET_EXCLUDE.publicCsafKeys).toBe(0);
  });

  it('is the only list the module exports', () => {
    const mod = require('../../imports/server/security/companySecretFields');
    expect(Object.keys(mod)).toEqual(['COMPANY_SECRET_EXCLUDE']);
  });

  it('every value is an exclusion (0)', () => {
    Object.values(COMPANY_SECRET_EXCLUDE).forEach((v) => expect(v).toBe(0));
  });
});

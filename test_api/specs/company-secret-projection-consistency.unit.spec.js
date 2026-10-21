/* eslint-disable no-undef */
// Cross-projection consistency guard for the DDP-hardening change
// (the canonical company/getCompanyCurrent lists + the getUserCompanies sweep).
// The Enterprise companies pages (enterpriseCompanyList / companyDetails
// publications) were removed; this spec now covers the remaining sites.
//
// Round 1 derived the canonical secret set from the companyDetails source text and
// asserted the two new sites mirrored it. That left a gap (Security round-2
// Finding 2): companyDetails itself OMITTED publicCsafKeys, so the derived check
// could not enforce it. Round 2 CENTRALIZES the secret set in one exported constant
// (imports/server/security/companySecretFields.js) and applies it to all sites.
// This spec now:
//   1. takes the canonical secret set FROM the constant (single source of truth),
//   2. asserts all remaining projection sites reference the centralized constant (so
//      no site can re-introduce an inline list that drifts),
//   3. explicitly enforces publicCsafKeys is in the canonical set (Finding 2).
// Add a new `secret: 0` to the constant and every site inherits it automatically.
//
// Source-text assertion (no Meteor import for the source) so the jest harness runs
// it serverless; the secret set is imported from the centralized constant.
const fs = require('fs');
const path = require('path');
const {
  COMPANY_SECRET_EXCLUDE
} = require('../../imports/server/security/companySecretFields');

const companiesSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/server/collections/companies.js'),
  'utf8'
);
const usersSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/server/collections/users.js'),
  'utf8'
);

// Walk braces from the first '{' after `marker` to its matching close, returning
// the enclosed block (used to isolate a publish / method body).
function blockAfter(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

// Canonical secret set: the one centralized constant, which every projection
// site below is expected to reference by name.
const canonicalSecrets = Object.keys(COMPANY_SECRET_EXCLUDE);
const companyBody = blockAfter(companiesSrc, "Meteor.publish('company'");
const getCompanyCurrentBody = blockAfter(companiesSrc, 'getCompanyCurrent: async function');
const getUserCompaniesBody = blockAfter(usersSrc, 'getUserCompanies: async function');

describe('#85 company-secret projection consistency (remaining sites stay in sync)', () => {
  it('locates all projection bodies', () => {
    expect(companyBody).not.toBeNull();
    expect(getCompanyCurrentBody).not.toBeNull();
    expect(getUserCompaniesBody).not.toBeNull();
  });

  it('the canonical secret set is non-empty and contains every known secret family', () => {
    expect(canonicalSecrets.length).toBeGreaterThanOrEqual(11);
    ['apiKeys', 'externalApiKeys', 'publicBoMKeys', 'publicNoticeKeys',
      'publicReleaseKeys', 'publicCsafKeys', 'jira.passwd', 'tfs.token',
      'github.token', 'leanix.token', 'scanoss.token'].forEach((f) => {
      expect(canonicalSecrets).toContain(f);
    });
  });

  it('explicitly enforces publicCsafKeys (Finding 2 - the previously-dropped bearer key)', () => {
    expect(COMPANY_SECRET_EXCLUDE.publicCsafKeys).toBe(0);
  });

  describe('every site references the centralized constant (no inline drift)', () => {
    it('company publication uses COMPANY_SECRET_EXCLUDE', () => {
      expect(companyBody).toMatch(/COMPANY_SECRET_EXCLUDE\b/);
    });
    it('getCompanyCurrent uses COMPANY_SECRET_EXCLUDE', () => {
      expect(getCompanyCurrentBody).toMatch(/fields:\s*COMPANY_SECRET_EXCLUDE\b/);
    });
    it('getUserCompanies uses COMPANY_SECRET_EXCLUDE', () => {
      expect(getUserCompaniesBody).toMatch(/fields:\s*COMPANY_SECRET_EXCLUDE\b/);
    });
  });

  // One list is the point: a second one could start hiding a different set at a
  // different site without any of the assertions above noticing.
  it('the module exports exactly one list', () => {
    const mod = require('../../imports/server/security/companySecretFields');
    expect(Object.keys(mod)).toEqual(['COMPANY_SECRET_EXCLUDE']);
  });
});

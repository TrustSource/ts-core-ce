/* eslint-disable no-undef */
// Static-source regression for the DDP hardening sweep (company-doc class):
// `getUserCompanies` (users.js) returns the company docs for every company the
// caller is a member of, and is called by the sidebar company switcher on every
// page load (ReactiveMethod.call). It previously returned the FULL company doc -
// bypassing the `company` / `getCompanyCurrent` publication field-exclusions and
// shipping plaintext REST `apiKeys`, integration tokens, and the publicCsafKeys
// bearer key to the client. The switcher only needs {_id, name}. The secret set is centralized so it
// cannot drift; this asserts the method applies the BASE set.
//
// Source-text assertion (no Meteor import for the source) so the jest harness runs
// it serverless; the secret set is imported from the centralized constant.
const fs = require('fs');
const path = require('path');
const {COMPANY_SECRET_EXCLUDE} = require('../../imports/server/security/companySecretFields');

const usersSrc = fs.readFileSync(
  path.join(__dirname, '../../imports/server/collections/users.js'),
  'utf8'
);

function methodBody(src, name) {
  const start = src.indexOf(name + ': async function');
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

const body = methodBody(usersSrc, 'getUserCompanies');

const SECRET_FIELDS = Object.keys(COMPANY_SECRET_EXCLUDE);

describe('#85 sweep: getUserCompanies omits company secrets', () => {
  it('is present', () => {
    expect(body).not.toBeNull();
  });

  it('applies the centralized BASE secret-exclusion set as the fields projection', () => {
    expect(body).toMatch(/fields:\s*COMPANY_SECRET_EXCLUDE/);
  });

  it('the centralized BASE set excludes every secret (incl. publicCsafKeys)', () => {
    SECRET_FIELDS.forEach((field) => {
      expect(COMPANY_SECRET_EXCLUDE[field]).toBe(0);
    });
    expect(COMPANY_SECRET_EXCLUDE.publicCsafKeys).toBe(0);
  });
});

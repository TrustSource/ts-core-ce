/* eslint-disable no-undef */
// Pure unit test for the company provisioning-field guard (CVD provisioning
// hardening). No Meteor, no running app - requires the dependency-free CommonJS
// module directly (same dual-consumption pattern as psirt/psirtClient.js and
// converter/sortKeys.js).
//
// Contract: `tenantId`, `realmId`, `providerId`, `enterprise`, `allowedLicenses`
// and `externalApiKeys` (legacy per-company service credentials, no longer used)
// may ONLY be set externally / directly in
// the DB (provisioning). Any in-app $set object is passed through
// stripProtectedCompanyFields(), which removes any key whose ROOT segment is one
// of those fields (so dotted sub-paths like `enterprise.x` or
// `externalApiKeys.psirt.value` are stripped too). Non-object input is returned
// unchanged.
const fs = require('fs');
const path = require('path');
const {
  COMPANY_READONLY_FIELDS,
  stripProtectedCompanyFields
} = require('../../imports/lib/interactors/companies/protectedFields');

describe('#106 COMPANY_READONLY_FIELDS', () => {
  it('is exactly the six provisioning fields (incl. externalApiKeys credential material)', () => {
    expect(COMPANY_READONLY_FIELDS).toEqual([
      'tenantId',
      'realmId',
      'providerId',
      'enterprise',
      'allowedLicenses',
      'externalApiKeys'
    ]);
  });
});

describe('#106 stripProtectedCompanyFields', () => {
  it.each(['tenantId', 'realmId', 'providerId', 'enterprise', 'allowedLicenses', 'externalApiKeys'])(
    'removes the top-level protected field %p',
    (field) => {
      const out = stripProtectedCompanyFields({name: 'Acme', [field]: 'x'});
      expect(out).toEqual({name: 'Acme'});
      expect(field in out).toBe(false);
    }
  );

  it('removes a dotted sub-path whose root is protected (e.g. enterprise.x)', () => {
    const out = stripProtectedCompanyFields({
      name: 'Acme',
      'enterprise.flag': true,
      'allowedLicenses.0': 'psirt',
      'tenantId.sub': 'x'
    });
    expect(out).toEqual({name: 'Acme'});
  });

  it('strips a client attempt to write the psirt key secret via externalApiKeys.psirt.value', () => {
    // The new psirt key secret. A client-shaped $set that tries to plant/overwrite the
    // per-company CVD key must be stripped before it reaches Companies.updateAsync
    // (server-side provisioning writes it via a DIRECT updateAsync that bypasses
    // this strip and allow/deny).
    const out = stripProtectedCompanyFields({
      name: 'Acme',
      'externalApiKeys.psirt.value': 'attacker-planted-key',
      externalApiKeys: {psirt: {value: 'also-attacker'}}
    });
    expect(out).toEqual({name: 'Acme'});
    expect('externalApiKeys.psirt.value' in out).toBe(false);
    expect('externalApiKeys' in out).toBe(false);
  });

  it('keeps non-protected fields (incl. ones that merely start with similar text)', () => {
    const input = {
      name: 'Acme',
      email: 'a@b.c',
      enterpriseName: 'not-protected',
      'jira.type': 'cloud',
      allowedLicensesCount: 3
    };
    expect(stripProtectedCompanyFields(input)).toEqual(input);
  });

  it('strips protected while keeping the rest in a mixed object', () => {
    const out = stripProtectedCompanyFields({
      name: 'Acme',
      tenantId: 'evil',
      realmId: 'evil',
      providerId: 'evil',
      enterprise: 'evil',
      allowedLicenses: ['psirt'],
      billingEmail: 'b@c.d'
    });
    expect(out).toEqual({name: 'Acme', billingEmail: 'b@c.d'});
  });

  it('yields {} when the object contains only protected fields', () => {
    const out = stripProtectedCompanyFields({tenantId: 'x', allowedLicenses: ['psirt'], enterprise: 'y'});
    expect(out).toEqual({});
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('returns non-object / array / null input unchanged', () => {
    expect(stripProtectedCompanyFields(null)).toBeNull();
    expect(stripProtectedCompanyFields(undefined)).toBeUndefined();
    expect(stripProtectedCompanyFields('str')).toBe('str');
    expect(stripProtectedCompanyFields(42)).toBe(42);
    const arr = [1, 2];
    expect(stripProtectedCompanyFields(arr)).toBe(arr);
  });

  it('does not mutate the input object', () => {
    const input = {name: 'Acme', tenantId: 'x'};
    const snapshot = JSON.stringify(input);
    stripProtectedCompanyFields(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input.tenantId).toBe('x');
  });

  it('returns a new object (shallow copy), not the same reference', () => {
    const input = {name: 'Acme'};
    expect(stripProtectedCompanyFields(input)).not.toBe(input);
  });
});

describe('Companies client writes', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../imports/server/collections/companies.js'), 'utf8');

  it('has no allow rule, so the client mutators cannot change a company', () => {
    expect(src).not.toMatch(/Companies\.allow\(/);
  });

  it('denies every client insert, update and remove', () => {
    expect(src).toMatch(/Companies\.deny\(\{\s*insert: \(\) => true,\s*update: \(\) => true,\s*remove: \(\) => true\s*\}\)/);
  });
});

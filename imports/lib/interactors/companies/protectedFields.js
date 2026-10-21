// Company provisioning fields that may ONLY be set externally / directly in the
// database - never via any in-app write path. denyUpdate
// is a no-op in the vendored simple-schema and collection-hooks are dead on the
// async mutators here, so the invariant is enforced in the interactor write path
// by stripping these keys from any client-shaped $set object before it reaches
// Companies.updateAsync.
//
// `externalApiKeys` held per-company service credentials, no longer used.
// Nothing writes it any more; it stays protected so
// no client write path can put credential-shaped data back onto a company.
//
// CommonJS (no meteor/* imports) so Jest can require it directly - the same
// dual-consumption pattern as converter/sortKeys.js.

const COMPANY_READONLY_FIELDS = [
  'tenantId',
  'realmId',
  'providerId',
  'enterprise',
  'allowedLicenses',
  'externalApiKeys'
];

const READONLY_SET = new Set(COMPANY_READONLY_FIELDS);

// Return a shallow copy of a plain `fields` object with every key whose ROOT
// segment (`key.split('.')[0]`) is a protected provisioning field removed - so a
// dotted sub-path such as `enterprise.flag` or `allowedLicenses.0` is stripped
// too, not just the bare field. A non-object / array / null input is returned
// unchanged. The input is never mutated.
function stripProtectedCompanyFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return fields;
  }
  const out = {};
  Object.keys(fields).forEach((key) => {
    const root = key.split('.')[0];
    if (!READONLY_SET.has(root)) {
      out[key] = fields[key];
    }
  });
  return out;
}

module.exports = {COMPANY_READONLY_FIELDS, stripProtectedCompanyFields};

// Who may assign a CWE to a rule the scanning tool left unclassified.
//
// Deliberately narrower than the roles allowed to create a risk from a finding:
// an assignment is a claim about security-relevant behaviour, and one this
// company can later nominate as every company's default.
//
// Dependency-free CommonJS so the client role check and the server-side guard in
// set.js read the same list, the same way RISK_ORIGIN_VALUES is shared.
const CWE_MAPPING_WRITE_ROLES = ['company_security_manager', 'account_admin'];

module.exports = {CWE_MAPPING_WRITE_ROLES};

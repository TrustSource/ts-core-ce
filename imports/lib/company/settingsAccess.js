// WHO may change each company setting. Each list is used by the server check and
// by the page or control that offers the change, so the UI never shows a setting
// to a role the server then refuses (and the server never accepts a role the UI
// hides it from).

export const PRIVATE_ALGORITHM_ROLES = ['account_admin', 'company_security_manager', 'compliance_manager', 'manager'];

export const MANUAL_VULNERABILITY_ROLES = ['account_admin', 'company_security_manager', 'company_component_manager',
  'compliance_manager', 'manager'];

export const ENDOFLIFE_POLICY_ROLES = ['account_admin', 'company_security_manager', 'compliance_manager', 'manager'];

// Company allow/deny lists written through updateCollection, by attribute prefix.
export const LICENSE_LIST_ROLES = ['account_admin', 'compliance_manager', 'manager'];
export const COMPONENT_LIST_ROLES = ['account_admin', 'compliance_manager', 'company_security_manager',
  'company_component_manager', 'manager'];

// "Enforce allow" switch on the company license lists.
export const REQUIRE_WHITELIST_ROLES = ['account_admin', 'compliance_manager', 'manager'];

export const LEGAL_TEMPLATE_ROLES = ['account_admin', 'compliance_manager'];

/**
 * Roles that may write `attribute` of the company document through
 * updateCollection. Only the allow/deny lists are written that way; any other
 * attribute is reserved for the Account admin.
 *
 * @param {String} attribute e.g. 'licenseConfig.whitelist'
 * @returns {Array<String>}
 */
export function companyListRoles(attribute) {
  const top = String(attribute || '').split('.')[0];
  if (top === 'licenseConfig') {
    return LICENSE_LIST_ROLES;
  }
  if (top === 'componentConfig') {
    return COMPONENT_LIST_ROLES;
  }
  return ['account_admin'];
}

// For `{{#if isInRole ...}}`, which takes a comma-separated string.
export function rolesString(roles) {
  return roles.join(',');
}

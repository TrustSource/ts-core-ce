import {Template} from 'meteor/templating';
import {
  PRIVATE_ALGORITHM_ROLES, MANUAL_VULNERABILITY_ROLES, ENDOFLIFE_POLICY_ROLES, LICENSE_LIST_ROLES,
  COMPONENT_LIST_ROLES, REQUIRE_WHITELIST_ROLES, LEGAL_TEMPLATE_ROLES, rolesString
} from '/imports/lib/company/settingsAccess';

const SETTINGS_ROLES = {
  privateAlgorithms: PRIVATE_ALGORITHM_ROLES,
  manualVulnerabilities: MANUAL_VULNERABILITY_ROLES,
  endoflifePolicy: ENDOFLIFE_POLICY_ROLES,
  licenseLists: LICENSE_LIST_ROLES,
  componentLists: COMPONENT_LIST_ROLES,
  requireWhitelist: REQUIRE_WHITELIST_ROLES,
  legalTemplates: LEGAL_TEMPLATE_ROLES
};

// The roles that may change a company setting, for `{{#if isInRole (settingsRoles 'x') companyId}}`,
// from the same lists the server checks (imports/lib/company/settingsAccess.js).
Template.registerHelper('settingsRoles', function (name) {
  return rolesString(SETTINGS_ROLES[name] || ['account_admin']);
});

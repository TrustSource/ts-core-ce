import {expect} from 'chai';
import {companyListRoles, LICENSE_LIST_ROLES, COMPONENT_LIST_ROLES, rolesString} from './settingsAccess';

describe('settingsAccess.companyListRoles (#25)', function () {
  it('maps each company list to the roles that manage it', function () {
    expect(companyListRoles('licenseConfig.whitelist')).to.equal(LICENSE_LIST_ROLES);
    expect(companyListRoles('componentConfig.blacklist')).to.equal(COMPONENT_LIST_ROLES);
  });

  it('reserves any other company attribute for the Account admin', function () {
    expect(companyListRoles('requireWhitelist')).to.deep.equal(['account_admin']);
    expect(companyListRoles(undefined)).to.deep.equal(['account_admin']);
  });

  it('renders a role list for isInRole', function () {
    expect(rolesString(['a', 'b'])).to.equal('a,b');
  });
});

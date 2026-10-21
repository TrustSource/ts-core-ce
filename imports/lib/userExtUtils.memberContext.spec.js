import {expect} from 'chai';
import UserExtUtils from './userExtUtils';

// hasAccessRight used to test `entity.members`, a field that does not exist, so
// every Developer got the member rights. Members live in relatedUsers.members.
describe('UserExtUtils.memberContext (#26)', function () {
  const developer = UserExtUtils.allRoles().find((role) => role.key === 'developer');
  const manager = UserExtUtils.allRoles().find((role) => role.key === 'manager');
  const withMembers = {relatedUsers: {members: ['u1', 'u2']}};

  it('gives a listed Developer the member rights', function () {
    expect(UserExtUtils.memberContext(developer, withMembers, 'u1')).to.equal('member');
  });

  it('gives an unlisted Developer the non-member rights when the entity has members', function () {
    expect(UserExtUtils.memberContext(developer, withMembers, 'u3')).to.equal('nonMember');
  });

  it('keeps the base rights when the entity has no members', function () {
    expect(UserExtUtils.memberContext(developer, {relatedUsers: {members: []}}, 'u1')).to.equal(null);
    expect(UserExtUtils.memberContext(developer, {relatedUsers: {}}, 'u1')).to.equal(null);
    expect(UserExtUtils.memberContext(developer, {members: ['u1']}, 'u1')).to.equal(null);
    expect(UserExtUtils.memberContext(developer, undefined, 'u1')).to.equal(null);
  });

  it('does not apply to roles without member contexts', function () {
    expect(UserExtUtils.memberContext(manager, withMembers, 'u1')).to.equal(null);
    expect(UserExtUtils.memberContext(manager, withMembers, 'u3')).to.equal(null);
  });
});

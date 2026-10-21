// Seed the canonical role list into Meteor.roles in v4 format
// {_id: roleName, children: []} so Roles.setUserRolesAsync() does not
// fail with "Role 'X' does not exist." on a fresh / empty database.
// Idempotent: $setOnInsert + upsert per role.
import {Meteor} from 'meteor/meteor';

const CANONICAL_ROLES = [
  'admin',
  'account_admin',
  'manager',
  'developer',
  'compliance_manager',
  'portfolio_manager',
  'company_component_manager',
  'company_security_manager'
];

Meteor.startup(async () => {
  try {
    let created = 0;
    for (const roleName of CANONICAL_ROLES) {
      const result = await Meteor.roles.upsertAsync(
        {_id: roleName},
        {$setOnInsert: {_id: roleName, children: []}}
      );
      if (result.insertedId) created++;
    }
    if (created > 0) {
      console.log(`[roles-seed] Created ${created} canonical role(s)`);
    }
  } catch (e) {
    console.error('[roles-seed] Error seeding roles:', e);
  }
});

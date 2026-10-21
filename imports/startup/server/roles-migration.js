// Migrate roles data from alanning:roles v1/v2 format to v4.0 format
// Old format: user.roles = { companyId: ['role1', 'role2'] }
//             roles collection: { _id: 'xxx', name: 'roleName' }
// New format: role-assignment collection with { user: {_id}, role: {_id}, scope, inheritedRoles }
//             roles collection: { _id: 'roleName', children: [] }
import { Meteor } from 'meteor/meteor';

// eslint-disable-next-line no-unused-vars
async function migrateRoles() {
  // Drop the old unique index on 'name' field (from roles v1/v2)
  const rawRoles = Meteor.roles.rawCollection();
  try {
    await rawRoles.dropIndex('name_1');
    console.log('=> Dropped legacy "name_1" index on roles collection.');
  } catch (e) {
    // Index might not exist, that's fine
    if (e.codeName !== 'IndexNotFound') {
      console.log('=> Could not drop legacy "name_1" index on roles collection:', e.message);
    }
  }

  // Clear old-format roles (they used {_id: 'xxx', name: 'roleName'})
  // We'll recreate them in v4 format: {_id: 'roleName', children: []}
  const oldRoles = await Meteor.roles.find().fetchAsync();
  if (oldRoles.length > 0 && oldRoles[0].name) {
    console.log('=> Removing old-format roles documents.');
    await rawRoles.deleteMany({});
  }

  // Collect all role names from user documents with old-format roles
  const allRoleNames = new Set();
  const users = await Meteor.users.find({roles: {$exists: true, $type: 'object'}}).fetchAsync();

  if (!users.length) {
    return;
  }

  for (const user of users) {
    if (user.roles && typeof user.roles === 'object' && !Array.isArray(user.roles)) {
      for (const scope of Object.keys(user.roles)) {
        const roles = user.roles[scope];
        if (Array.isArray(roles)) {
          roles.forEach(r => allRoleNames.add(r));
        }
      }
    }
  }

  // Create roles in v4 format
  for (const roleName of allRoleNames) {
    const existing = await Meteor.roles.findOneAsync({_id: roleName});
    if (!existing) {
      await Meteor.roles.insertAsync({_id: roleName, children: []});
      console.log(`=> Created role "${roleName}".`);
    }
  }

  // Create role assignments (upsert ensures idempotency - safe to re-run).
  // After migrating a user we $unset their legacy `roles` field so subsequent
  // startups don't re-seed assignments that were later removed via Roles v4
  // (e.g. Roles.setUserRolesAsync replacing the set). Without the unset, any
  // role an admin removes through the UI would silently reappear next boot.
  let migrated = 0;
  let skipped = 0;
  let cleanedUsers = 0;
  for (const user of users) {
    if (user.roles && typeof user.roles === 'object' && !Array.isArray(user.roles)) {
      for (const scope of Object.keys(user.roles)) {
        const roles = user.roles[scope];
        if (Array.isArray(roles)) {
          for (const roleName of roles) {
            const result = await Meteor.roleAssignment.upsertAsync(
              {'user._id': user._id, 'role._id': roleName, scope: scope},
              {
                $setOnInsert: {
                  user: {_id: user._id},
                  role: {_id: roleName},
                  scope: scope,
                  inheritedRoles: [{_id: roleName}]
                }
              }
            );
            if (result.insertedId) {
              migrated++;
            } else {
              skipped++;
            }
          }
        }
      }
      await Meteor.users.updateAsync(user._id, {$unset: {roles: ''}});
      cleanedUsers++;
    }
  }

  console.log(`=> Roles migration: ${migrated} new assignments created, ` +
    `${skipped} already existed, ${cleanedUsers} legacy roles fields cleaned ` +
    `(${users.length} users checked).`);
}

Meteor.startup(async () => {
  try {
    // prod is migrated, disable for now
    // await migrateRoles();
  } catch (e) {
    console.error('=> Roles migration failed:', e);
  }
});

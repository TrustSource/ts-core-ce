 
import {Meteor} from 'meteor/meteor';
import {Roles} from 'meteor/alanning:roles';
import _ from 'underscore';
import Projects from '/imports/lib/collections/projects';
import Modules from '/imports/lib/collections/modules';
import Companies from '/imports/lib/collections/companies';
import Approves from '/imports/lib/collections/approves';
import Utils from '/imports/server/ServerUtils';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {mailFooter} from '/imports/server/mail/footer';
import {COMPANY_SECRET_EXCLUDE} from '/imports/server/security/companySecretFields';
import {deniesClientProfileWrite} from '/imports/lib/interactors/users/protectedProfileFields';

/**
 * Helper: fetch users in a given role for a company scope (Roles v4 API).
 * Returns an array of user documents.
 *
 * `queryOptions` is passed straight through to Meteor.users.find - pass
 * `{fields: SAFE_USER_FIELDS}` whenever the result is returned to the client so
 * the sensitive `services` field (auth tokens / password hash) is never fetched.
 * Server-internal callers may omit it (they need the full document).
 */
async function fetchUsersInRole(roleNames, companyId, queryOptions) {
  const cursor = await Roles.getUsersInRoleAsync(roleNames, {scope: companyId}, queryOptions);
  return await cursor.fetchAsync();
}
import UserExtUtils from '/imports/lib/userExtUtils';
import {SAFE_USER_FIELDS, sanitizeUsers} from '/imports/server/security/safeUserFields';
import {UserSchema} from '/imports/lib/schemas/userSchema';
import {userNameProblem, normalizeUserName, USER_NAME_MESSAGES} from '/imports/lib/user/nameValidation';
import {modifierTouchesAccountStatus} from '/imports/lib/accountStatus';
import {isBlankImportRow} from '/imports/lib/user/importRow';

// User management (roles, CSV import, removal) is the Account admin's, as in the
// UI and ROLES_AND_PERMISSIONS.md.
const USER_ADMIN_ROLES = ['account_admin'];

// The CSV import and its preview mutate / read the roles of existing company
// users. The page is UI-gated to account_admin, but the methods are reachable
// directly over DDP, so enforce the same role server-side (matching setUserRole).
async function assertCanManageUsers(currentUser) {
  const companyId = currentUser && currentUser.profile && currentUser.profile.companyId;
  if (!companyId || !await Roles.userIsInRoleAsync(currentUser, USER_ADMIN_ROLES, companyId)) {
    throw new Meteor.Error(403, 'Access Denied');
  }
}

Meteor.publish('companyUsers', async function () {
  const user = await Meteor.users.findOneAsync(this.userId);
  if (this.userId && await Roles.userIsInRoleAsync(this.userId, ['account_admin','manager'], user.profile.companyId)) {
    const companyId = user.profile.companyId;
    // Get user IDs from role assignments for this company scope
    const assignments = await Meteor.roleAssignment.find({scope: companyId}).fetchAsync();
    const userIds = [...new Set(assignments.map(a => a.user._id))];
    // accountStatus drives the Suspend / Reactivate button on User management, and
    // the 2FA type (never its secret) the Reset 2FA button.
    return Meteor.users.find(
      {_id: {$in: userIds}},
      {fields: Object.assign({accountStatus: 1, 'services.twoFactorAuthentication.type': 1}, SAFE_USER_FIELDS)}
    );
  } else {
    this.ready();
  }
});

Meteor.publish('userData', async function () {
  if (this.userId) {
    return Meteor.users.find({_id: this.userId},
      {fields: {'createdAt': 1, 'componentConfig': 1, 'licenseConfig': 1, 'intro': 1}});
  } else {
    this.ready();
  }
});

// Publish role assignments (required by alanning:roles 4.0)
// For account_admin/manager: publish all assignments in their company scope
// For regular users: publish only their own assignments
Meteor.publish('roleAssignment', async function () {
  if (this.userId) {
    const user = await Meteor.users.findOneAsync(this.userId);
    if (user && user.profile && user.profile.companyId) {
      const companyId = user.profile.companyId;
      const isAdmin = await Roles.userIsInRoleAsync(this.userId, ['account_admin', 'manager'], companyId);
      if (isAdmin) {
        // Company-wide assignments (for users page) + own assignments in all scopes (for company switcher)
        return Meteor.roleAssignment.find({
          $or: [
            {scope: companyId},
            {'user._id': this.userId}
          ]
        });
      }
    }
    return Meteor.roleAssignment.find({'user._id': this.userId});
  } else {
    this.ready();
  }
});

// Publish roles collection for role hierarchy lookups
Meteor.publish('roles', async function () {
  if (this.userId) {
    return Meteor.roles.find();
  } else {
    this.ready();
  }
});

Meteor.publish('userList', async function () {
  this.ready();
});

Meteor.publish('userDetails', async function (userId) {
  const caller = await Meteor.users.findOneAsync(this.userId);
  const companyId = caller && caller.profile && caller.profile.companyId;
  if (!companyId || typeof userId !== 'string') {
    return this.ready();
  }
  // Only expose a user who shares the caller's company scope, and never the
  // sensitive `services` field (auth tokens / password hashes) - the previous
  // unscoped, unfielded find leaked any user's full document by id.
  const inCompany = await Meteor.roleAssignment.findOneAsync({'user._id': userId, scope: companyId});
  if (!inCompany) {
    return this.ready();
  }
  return Meteor.users.find({_id: userId},
    {fields: SAFE_USER_FIELDS});
});

// The only direct client write to a user document is the account-activation page
// (own profile name, through accounts-base's own allow rule, narrowed by the deny rule
// below). Role changes, list settings and every other user edit go through server
// methods, so the client cannot insert or remove users or touch any other field.
Meteor.users.deny({
  insert: () => true,
  update: (userId, doc, fieldNames) => !(fieldNames.length === 1 && fieldNames[0] === 'profile'),
  remove: () => true,
  fetch: ['_id']
});

// accounts-base registers its own allow rule that lets a client modify any
// sub-key of its own `profile`, and one passing allow rule is enough.
// `profile.companyId` decides which company every publication and method
// serves: without this deny rule a user could move itself into any company
// from the browser console. Only the own name and newsletter flag stay
// client-writable (account activation); server-side updateAsync bypasses
// allow/deny.
Meteor.users.deny({
  update: function (userId, doc, fieldNames, modifier) {
    return deniesClientProfileWrite(userId, doc, fieldNames, modifier);
  },
  fetch: ['_id']
});

// Write-lock for the account-status fields. Top-level
// accountStatus / accountStatusInfo / accountClearing: all writes are owned by
// a SEPARATE admin app writing the shared DB from another process; ts-app only
// reads them. In CE, Users.SetAccountStatus (Account admin) writes them through
// updateAccountStatusAsync below, which is not exposed to any other caller.
//
// SCOPE OF THIS GUARANTEE: it covers UPDATE/UPSERT only. It is authoritative for
// the ts-app-originating `Mongo.Collection` mutators updateAsync / upsertAsync
// (and therefore server methods and the REST layer, which go through them) and
// fires at any depth, including dotted sub-paths that the schema's blackbox
// `custom` validator cannot see. It does NOT (and must not) cover
// `rawCollection()` / native-driver writes: that is exactly the external admin
// app's write path into the shared DB, which is intended, not a hole. This is a
// per-process wrapper, so that other process is unaffected.
//
// INSERT IS INTENTIONALLY NOT LOCKED: no client-reachable insert path accepts
// these fields (onCreateUser copies only the profile from a client sign-up).
//
// IMPLEMENTATION NOTE (deviation from the original brief): the brief specified a
// `Meteor.users.before.update` collection-hook. That does NOT work in this
// stack: under Meteor 3 the server-side `_collection` exposes ONLY async
// mutators (updateAsync/upsertAsync/...), while matb33:collection-hooks@1.3.2
// wraps the (non-existent) synchronous `_collection.update`, so before/after
// hooks never fire for the async mutators. We therefore wrap `updateAsync`
// directly, ABOVE collection2, so a clean 403 surfaces before collection2 can
// re-wrap it. `upsertAsync` is covered transitively
// (Mongo.Collection.prototype.upsertAsync delegates to this.updateAsync). Do NOT
// use `denyUpdate` in the schema either - it is a dead no-op here (proof:
// profile.companyId has denyUpdate:true yet changeCompany() below updates it).
//
// modifierTouchesAccountStatus() inspects the update modifier
// ($set/$unset/... incl. dotted sub-paths and $rename targets); a legitimate
// write to any other field passes through untouched.
const unlockedUpdateAsync = Meteor.users.updateAsync.__unlocked || Meteor.users.updateAsync;

/**
 * The one in-process write path for the locked fields: Users.SetAccountStatus,
 * the Account admin's Suspend / Reactivate in CE. A normal (not raw) update, so
 * publications and the write fence see the change at once. It bypasses the
 * schema, whose custom rule refuses every write to these fields; the caller
 * validates the values.
 */
export function updateAccountStatusAsync(selector, modifier) {
  return unlockedUpdateAsync.call(Meteor.users, selector, modifier, {bypassCollection2: true});
}

(function lockAccountStatusWrites() {
  const originalUpdateAsync = Meteor.users.updateAsync;
  if (!originalUpdateAsync.__accountStatusLocked) {
    const lockedUpdateAsync = function (selector, modifier, ...rest) {
      if (modifierTouchesAccountStatus(modifier)) {
        return Promise.reject(new Meteor.Error(403, 'accountStatus is read-only'));
      }
      return originalUpdateAsync.call(this, selector, modifier, ...rest);
    };
    lockedUpdateAsync.__accountStatusLocked = true;
    lockedUpdateAsync.__unlocked = originalUpdateAsync;
    Meteor.users.updateAsync = lockedUpdateAsync;
  }
})();

function getUserName(user) {
  if (user) {
    if (user.profile && user.profile.name) {
      return user.profile.name;
    }
    if (user.name) {
      return user.name;
    }
    if (user.emails && user.emails[0] && user.emails[0].address) {
      return user.emails[0].address;
    }
    if  (user.profile.email){
      return user.profile.email
    }
  }
  return false
}

Meteor.methods({
  // Update current user's intro flags (e.g. {chat: true}, {securityManager: true})
  updateUserIntro: async function (introField, value) {
    const userId = this.userId;
    if (!userId) throw new Meteor.Error(403, 'Access Denied');
    return await Meteor.users.updateAsync(userId, {$set: {['intro.' + introField]: value}});
  },

  // Update current user's config (licenseConfig or componentConfig attribute)
  updateUserConfig: async function (attribute, data) {
    const userId = this.userId;
    if (!userId) throw new Meteor.Error(403, 'Access Denied');
    const allowedAttributes = ['licenseConfig', 'componentConfig'];
    // Also allow dotted paths like licenseConfig.whitelist
    const topLevel = attribute.split('.')[0];
    if (allowedAttributes.indexOf(topLevel) === -1) {
      throw new Meteor.Error(400, 'Invalid attribute: ' + attribute);
    }
    return await Meteor.users.updateAsync(userId, {$set: {[attribute]: data}});
  },

  // Update current user's profile fields (name, email, theme, locale, notifications)
  updateUserProfile: async function (fields) {
    const userId = this.userId;
    if (!userId) throw new Meteor.Error(403, 'Access Denied');
    const allowedFields = ['profile.name', 'profile.email', 'profile.theme', 'profile.locale', 'profile.notifications'];
    const setter = {};
    for (const key of Object.keys(fields)) {
      if (allowedFields.indexOf(key) === -1) {
        throw new Meteor.Error(400, 'INVALID');
      }
      setter[key] = fields[key];
    }
    // Meteor.users has no attached schema, so without this an empty or
    // whitespace-only name from a direct method call was stored as is.
    if (Object.prototype.hasOwnProperty.call(setter, 'profile.name')) {
      const nameProblem = userNameProblem(setter['profile.name']);
      if (nameProblem) {
        throw new Meteor.Error(400, USER_NAME_MESSAGES[nameProblem]);
      }
      setter['profile.name'] = normalizeUserName(setter['profile.name']);
    }
    return await Meteor.users.updateAsync(userId, {$set: setter});
  },

  setUserRole: async function (targetUserId, newRoles) {
    const currUser = await Meteor.userAsync();
    if (!currUser) throw new Meteor.Error(403, 'Access Denied');
    const companyId = currUser.profile && currUser.profile.companyId;
    if (!companyId) throw new Meteor.Error(400, 'No company');
    if (!await Roles.userIsInRoleAsync(currUser, USER_ADMIN_ROLES, companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const targetUser = await Meteor.users.findOneAsync(targetUserId);
    if (!targetUser) throw new Meteor.Error(404, 'User not found');
    // Check target user is in same company
    const targetRoles = await Roles.getRolesForUserAsync(targetUser, {scope: companyId});
    if (targetRoles.length === 0) throw new Meteor.Error(403, 'User not in company');
    // Validate roles
    const availableRoles = UserExtUtils.availableRolesKeys();
    const validRoles = (Array.isArray(newRoles) ? newRoles : [newRoles]).filter(r => availableRoles.includes(r));
    if (validRoles.length === 0) throw new Meteor.Error(400, 'Invalid role');
    await Roles.setUserRolesAsync(targetUserId, validRoles, {scope: companyId});
  },
  getUserCompanies: async function () {
    let user = await Meteor.userAsync();
    if (!user) return [];
    const scopes = await Roles.getScopesForUserAsync(user);
    // Returned to the client (sidebar company switcher) - exclude every company
    // secret (incl. publicCsafKeys) so this method does not bypass the `company` /
    // `getCompanyCurrent` publication field-exclusions (plaintext REST apiKeys,
    // integration tokens). Centralized BASE set; the switcher only reads
    // {_id, name}.
    return scopes.length > 0
      ? await Companies.find({'_id': { $in: scopes}}, {fields: COMPANY_SECRET_EXCLUDE}).fetchAsync()
      : [];
  },
  changeCompany: async function (companyId) {
    let user = await Meteor.userAsync();
    if (!user) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    // A user may only switch to a company they are a member of (have roles in).
    // Without this, setting profile.companyId to an arbitrary id grants full
    // read access to that tenant (all queries scope by user.profile.companyId).
    const scopes = await Roles.getScopesForUserAsync(user);
    if (typeof companyId !== 'string' || scopes.indexOf(companyId) === -1) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    await Meteor.users.updateAsync({_id: user._id}, {$set: {'profile.companyId': companyId}});
  },
  isItPossibleToFreeze: async function (user) {
    if (!user || !await Roles.userIsInRoleAsync(user, ['manager','compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    const cursor = await Roles.getUsersInRoleAsync(['compliance_manager'], {scope: user.profile.companyId});
    return await cursor.countAsync() > 0;
  },
  notifyAboutInitApproval: async function (user, projectId, approveData, approveId) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['manager','compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let users = await fetchUsersInRole(['compliance_manager'], user.profile.companyId);
    users = users.filter(function (user) {
      return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
    });

    let project = await Projects.findOneAsync(projectId);

    let approve = approveData || _.sortBy(_.filter(project.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse()[0];

    let followers = [];
    if(project && project.relatedUsers && project.relatedUsers.followers){
      const allCompanyUsers = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
      followers = allCompanyUsers.filter(u => project.relatedUsers.followers.includes(u._id));

      followers = _.filter(followers,function(item) {
        return !_.any(users,function (user) {
          return user._id === item._id
        })
      });
      followers = followers.filter(function (user) {
        return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
      });
    }

    for (const oneUser of users) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>Approval was initiated for project '+ escapeHtml((project && project.name)) +'</p>' +
        '<p>Approval name is ' + escapeHtml(approve.name) + '</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Approval was initiated for project ' + (project && project.name),userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: project && project.companyId,
        approveId: approveId,
        projectId: projectId,
        message: 'Approval was initiated for project: '+(project && project.name)+ '. Approve name is ' + approve.name,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    for (const oneUser of followers) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>You have decided to follow '+ escapeHtml((project && project.name)) +'</p>' +
        '<p>We send you this mail to inform you about a new approval ('+ escapeHtml(approve.name) +') that has been initiated</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Updates in project ' + (project && project.name),userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: project && project.companyId,
        approveId: approveId,
        projectId: projectId,
        message: 'New approval: '+approve.name+ ' has been initiated in project ' + (project && project.name),
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
  notifyAboutInitApprovalModule: async function (user, moduleId) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['manager','compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let users = await fetchUsersInRole(['compliance_manager'], user.profile.companyId);
    users = users.filter(function (user) {
      return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
    });

    let module = await Modules.findOneAsync(moduleId);

    let release = _.sortBy(_.filter(module.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse()[0];

    let followers = [];
    if(module.relatedUsers && module.relatedUsers.followers) {
      const allCompanyUsers2 = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
      followers = allCompanyUsers2.filter(u => module.relatedUsers.followers.includes(u._id));

      followers = _.filter(followers, function (item) {
        return !_.any(users, function (user) {
          return user._id === item._id
        })
      });
      followers = followers.filter(function (user) {
        return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
      });
    }

    for (const oneUser of users) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>Approval was initiated for module '+ escapeHtml(module.name) +'</p>' +
        '<p>Release name is ' + escapeHtml(release.name) + '</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Approval was initiated for module ' + module.name,userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: module.companyId,
        projectId: module.projectId,
        moduleId: module._id,
        message: 'Approval was initiated for module: '+module.name+ '. Release name is ' + release.name,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    for (const oneUser of followers) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>You have decided to follow '+ escapeHtml(module.name) +'</p>' +
        '<p>We send you this mail to inform you about a new release ('+ escapeHtml(release.name) +') that has been frozen</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Updates in module ' + module.name,userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: module.companyId,
        projectId: module.projectId,
        moduleId: module._id,
        message: 'New release: '+release.name+ ' has been frozen in module ' + module.name,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
   
  notifyAboutApprove: async function (user, projectId) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let users = await fetchUsersInRole(['manager'], user.profile.companyId);
    users = users.filter(function (user) {
      return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
    });

    let project = await Projects.findOneAsync(projectId);

    let release = _.sortBy(_.filter((project && project.release || []),function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse()[0];


    let followers = [];
    if(project && project.relatedUsers && project.relatedUsers.followers) {
      const allCompanyUsers3 = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
      followers = allCompanyUsers3.filter(u => project.relatedUsers.followers.includes(u._id));

      followers = _.filter(followers, function (item) {
        return !_.any(users, function (user) {
          return user._id === item._id
        })
      });
      followers = followers.filter(function (user) {
        return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
      });
    }

    for (const oneUser of users) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>Release for '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +' was ' +escapeHtml((release.approved ? 'approved':'rejected')) +'</p>' +
        '<p>Release name is ' + escapeHtml(release.name) + '</p>' +
        '<p>Comment was: ' + escapeHtml(release.comment) + '</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Release for ' + (project && project.name || 'REMOVED_PROJECT') +' was ' +
          (release.approved ? 'approved':'rejected'), userMailBody, true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: project.companyId,
        projectId: projectId,
        message: 'Release: '+ release.name +' for: '+(project && project.name || 'REMOVED_PROJECT')+
          ' was ' + (release.approved ? 'approved':'rejected') + ' Comment was: ' + release.comment,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    for (const oneUser of followers) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>You have decided to follow '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +'</p>' +
        '<p>We send you this mail to inform you about a new release ('+ escapeHtml((project && project.release &&
          project.release.name)) +') that has been provided ' + 'and declared compliant</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Updates in project ' + (project && project.name || 'REMOVED_PROJECT'),userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: project.companyId,
        projectId: projectId,
        message: 'New release: '+release.name+ ' has been provided and declared compliant in project ' +
          (project && project.name || 'REMOVED_PROJECT'),
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
  notifyAboutApproveModule: async function (user, moduleId) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let module = await Modules.findOneAsync(moduleId);

    let release = _.sortBy(_.filter(module.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse()[0];

    let followers = [];
    if(module.relatedUsers) {
      if(module.relatedUsers.followers){
        const allUsersAM = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
        followers = allUsersAM.filter(u => module.relatedUsers.followers.includes(u._id));
        followers = followers.filter(function (user) {
          return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
        });
      }
    }

    for (const oneUser of followers) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>You have decided to follow '+ escapeHtml(module.name) +'</p>' +
        '<p>We send you this mail to inform you about a new release ('+ escapeHtml(release.name) +') that has been provided ' +
        'and declared compliant</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Updates in module ' + module.name,userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: module.companyId,
        projectId: module.projectId,
        moduleId: module._id,
        message: 'New release: '+release.name+ ' has been provided and declared compliant in module ' + module.name,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
  notifyAboutApproveModuleReject: async function (user, moduleId) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let module = await Modules.findOneAsync(moduleId);

    let release = _.sortBy(_.filter(module.release,function (releaseItem) {
      return releaseItem.date
    }),function (releaseItem) {
      return releaseItem.date
    }).reverse()[0];

    let followers = [];
    if(module.relatedUsers) {
      if(module.relatedUsers.followers){
        const allUsersAMR = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
        followers = allUsersAMR.filter(u => module.relatedUsers.followers.includes(u._id));
        followers = followers.filter(function (user) {
          return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
        });
      }
    }

    for (const oneUser of followers) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>Release for '+ escapeHtml(module.name) +' was ' +escapeHtml((release.approved ? 'approved':'rejected')) +'</p>' +
        '<p>Release name is ' + escapeHtml(release.name) + '</p>' +
        '<p>Comment was: ' + escapeHtml(release.comment) + '</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Updates in module ' + module.name,userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: module.companyId,
        projectId: module.projectId,
        moduleId: module._id,
        message: 'Release: '+ release.name +' for: '+module.name+ ' was ' + (release.approved ? 'approved':'rejected')+
        ' Comment was: ' + release.comment,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
  notifyAboutWhiteListed: async function (user, item, comment, place, name, license) {
    const sender =  await Meteor.userAsync();
    if (!await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)){
      if (!user || !await Roles.userIsInRoleAsync(user, ['manager'], user.profile.companyId)) {
        if(user._id !== 'api'){
          throw new Meteor.Error(403, 'Access Denied');
        }
      }
      let users = await fetchUsersInRole(['compliance_manager'], user.profile.companyId);
      users = users.filter(function (user) {
        return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL'])
      });
      let type = 'Component';
      if(license || !item.version){
        type = 'License'
      }
      for (const oneUser of users) {
        const userMailBody =
          '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
          '<p>New item Whitelisted in '+ escapeHtml(place) +': '+ escapeHtml(name) +' </p>' +
          '<p>'+ escapeHtml(type) +': ' + escapeHtml((item.name || item.key || item.getName())) + '</p>' +
          '<p>Comment: ' + escapeHtml(comment) + '</p>' +
          mailFooter();
        let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
        if(EVENTS_BY_EMAIL){
          await Meteor.callAsync('_sendEmail',
            ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
            'Whitelisted ' + item.name +' in ' + name,userMailBody,
            true);
        }
        let inboxMessage = {
          userId: oneUser._id,
          companyId: user.profile.companyId,
          message: 'New item Whitelisted in '+ place +': '+ name +'. '+ type +': ' + (item.name || item.key || item.getName()),
          type: 'eventsNotifications',
          senderId: sender && sender._id,
          senderName: getUserName(sender)
        };
        await Meteor.callAsync('Messages.Create',inboxMessage);
      }
    }
    return true;
  },
  notifyAboutWhiteListedReject: async function (user, item, comment, place, name, license) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)) {
      if(user._id !== 'api'){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    let users = await fetchUsersInRole(['manager'], user.profile.companyId);
    users = users.filter(function (user) {
      return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL'])
    });

    let type = 'Component';
    if(license){
      type = 'License'
    }
    for (const oneUser of users) {
      const userMailBody =
        '<p>Dear ' + escapeHtml(((oneUser.profile && oneUser.profile.name) || (oneUser.emails && oneUser.emails[0].address))) + '!</p>' +
        '<p>Rejected Whitelisted in '+ escapeHtml(place) +': '+ escapeHtml(name) +' </p>' +
        '<p>'+ escapeHtml(type) +': ' + escapeHtml((item.name || item.key || item.getName())) + '</p>' +
        '<p>Comment: ' + escapeHtml(comment) + '</p>' +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          ((oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address)),
          'Reject Whitelisted ' + item.name +' in ' + name,userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: user.profile.companyId,
        message: 'Rejected Whitelisted in '+ place +': '+ name +'. '+ type +': ' + (item.name || item.key || item.getName()),
        type: 'eventsNotifications',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  },
  getUsersManagers: async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['developer','portfolio_manager','manager','compliance_manager', 'account_admin'],
      user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return sanitizeUsers(await fetchUsersInRole(['manager'], user.profile.companyId, {fields: SAFE_USER_FIELDS}));
  },
  getUsersAccountAdmins: async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['developer','portfolio_manager','manager','compliance_manager', 'account_admin'],
      user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return sanitizeUsers(await fetchUsersInRole(['account_admin'], user.profile.companyId, {fields: SAFE_USER_FIELDS}));
  },
  getUsersComplianceManagers: async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['developer','portfolio_manager','manager','compliance_manager', 'account_admin'],
      user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return sanitizeUsers(await fetchUsersInRole(['compliance_manager'], user.profile.companyId, {fields: SAFE_USER_FIELDS}));
  },
  getUsers: async function () {
    const user = await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['developer','portfolio_manager','manager', 'compliance_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    // Project out `services` at the DB layer (enrollment / reset / login tokens
    // and the bcrypt hash) and sanitize defensively before returning to client.
    const cursor = await Roles.getUsersInRoleAsync(['manager', 'compliance_manager', 'developer'], {scope: user.profile.companyId}, {fields: SAFE_USER_FIELDS});
    return sanitizeUsers(await cursor.fetchAsync());
  },
  getUsersCount: async function (roles) {
    const user = await Meteor.userAsync();
    const searchRoles = (roles && roles.length > 0) ? roles : null;
    if (searchRoles) {
      const cursor = await Roles.getUsersInRoleAsync(searchRoles, {scope: user.profile.companyId});
      return await cursor.countAsync();
    }
    // Count all users with any role in this company
    const cursor = await Roles.getUsersInRoleAsync(UserExtUtils.availableRolesKeys(), {scope: user.profile.companyId});
    return await cursor.countAsync();
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async importUsers( data ) {
    let result = [];
    const currentUser = await Meteor.userAsync();
    await assertCanManageUsers(currentUser);
    const currentCompany = await Companies.findOneAsync(currentUser.profile.companyId);
    const availableRoles = UserExtUtils.availableRolesKeys();
    for ( let i = 0; i < data.length; i++ ) {
      let user  = data[ i ];
      if (isBlankImportRow(user)) continue;
      const name = user['Name'];
      const email = user['Email'];
      let role = user['Roles'];
      const company = user['Company'];
      let checkCompany = company && currentCompany.name && company.replace(/\s/g,'') !== currentCompany.name.replace(/\s/g,'');
      if(checkCompany){
        result.push({
          status: 'error',
          message: 'Wrong company name: '+company
        });
      }else{
        if (name && email) {
          let validationsError = false;
          try {
            UserSchema.validate({
              profile: {
                name: name,
                email: email
              }
            });
          }catch (e) {
            validationsError = true
            result.push({
              status: 'error',
              message: e.reason
            });
          }
          if(!validationsError){
            let newUser = await Meteor.users.findOneAsync({$or: [{'emails.address': email}, {'profile.email': email}, {'username': email}]});
            const existingRoles = newUser ? await Roles.getRolesForUserAsync(newUser, {scope: currentUser.profile.companyId}) : [];
            let isUserInCompany = newUser && existingRoles.length > 0;
            if(isUserInCompany){
              if(!role){
                await Roles.removeUsersFromRolesAsync(newUser._id, existingRoles, {scope: currentUser.profile.companyId});
                result.push({
                  status: 'removed',
                  message: name
                });
              }else{
                let newRoles;
                if (role.indexOf(' ') > -1){
                  newRoles = _.filter(role.split(' '), function (oneRole){
                    return availableRoles.indexOf(oneRole) > -1
                  })
                } else if (availableRoles.indexOf(role) > -1){
                  newRoles = [role];
                } else {
                  newRoles = ['developer'];
                }
                await Roles.setUserRolesAsync(newUser._id, newRoles, {scope: currentUser.profile.companyId});
                result.push({
                  status: 'updated',
                  message: name
                });
              }
            }else{
              if(role){
                if (role.indexOf(' ') > -1){
                  let list = _.filter(role.split(' '), function (oneRole){
                    return availableRoles.indexOf(oneRole) > -1
                  })
                  role = list;
                } else if (availableRoles.indexOf(role) === -1){
                  role = 'developer';
                }
                try {
                  const response = await Meteor.callAsync('inviteUser', name, email, role);
                  if (response && response.error) {
                    result.push({
                      status: 'error',
                      message: response.error
                    });
                  } else {
                    result.push({
                      status: 'invited',
                      message: name
                    });
                  }
                } catch (error) {
                  result.push({
                    status: 'error',
                    message: error.reason
                  });
                }
              }else{
                result.push({
                  status: 'not_found',
                  message: name
                });
              }
            }
          }
        } else {
          let message = 'Please enter ';
          let entry = [];
          if(!name){
            entry.push('Name')
          }
          if(!email){
            entry.push('Email')
          }
          result.push({
            status: 'error',
            message: message + entry.join(' and ')
          });
        }
      }
    }
    let stats = _.countBy(result,function (item) {
      return item.status
    });
    return {
      result: result,
      stats: stats
    }
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async checkImportUsers( data ) {
    let result = [];
    const currentUser = await Meteor.userAsync();
    await assertCanManageUsers(currentUser);
    const currentCompany = await Companies.findOneAsync(currentUser.profile.companyId);
    for ( let i = 0; i < data.length; i++ ) {
      let user  = data[ i ];
      if (isBlankImportRow(user)) continue;
      const name = user['Name'];
      const email = user['Email'];
      let role = user['Roles'];
      const company = user['Company'];
      let checkCompany = company && currentCompany.name && company.replace(/\s/g,'') !== currentCompany.name.replace(/\s/g,'');
      if(checkCompany){
        result.push({
          status: 'error',
          message: 'Wrong company name: '+company
        });
      }else{
        if (name && email) {
          let validationsError = false;
          try {
            UserSchema.validate({
              profile: {
                name: name,
                email: email
              }
            });
          }catch (e) {
            validationsError = true
            result.push({
              status: 'error',
              message: e.reason
            });
          }
          if(!validationsError){
            let newUser = await Meteor.users.findOneAsync({$or: [{'emails.address': email}, {'profile.email': email}, {'username': email}]});
            const existingRoles2 = newUser ? await Roles.getRolesForUserAsync(newUser, {scope: currentUser.profile.companyId}) : [];
            let isUserInCompany = newUser && existingRoles2.length > 0;
            if(isUserInCompany){
              // PREVIEW ONLY: project the outcome, never write. This handler runs on
              // file-select (before the admin presses "Import CSV"); the actual role
              // update/removal happens in importUsers on confirmation. An empty Roles
              // cell for an existing user means "remove from company" (-> 'removed'),
              // otherwise the roles would be replaced (-> 'updated').
              result.push({
                status: role ? 'updated' : 'removed',
                message: name
              });
            }else{
              if(role){
                result.push({
                  status: 'invited',
                  message: name
                });
              }else{
                result.push({
                  status: 'not_found',
                  message: name
                });
              }
            }
          }
        } else {
          let message = 'Please enter ';
          let entry = [];
          if(!name){
            entry.push('Name')
          }
          if(!email){
            entry.push('Email')
          }
          result.push({
            status: 'error',
            message: message + entry.join(' and ')
          });
        }
      }
    }
    let stats = _.countBy(result,function (item) {
      return item.status
    });
    return {
      result: result,
      stats: stats,
      expected: true
    }
  },
   
  notifyAboutApprovedOrRejected: async function (user, approveId, apiUser) {
    const sender =  await Meteor.userAsync();
    if (!user || !await Roles.userIsInRoleAsync(user, ['compliance_manager'], user.profile.companyId)) {
      if((user && user._id !== 'api') || !apiUser){
        throw new Meteor.Error(403, 'Access Denied');
      }
    }

    let approve = await Approves.findOneAsync(approveId);

    let users = await fetchUsersInRole(['manager'], approve.companyId);
    users = users.filter(function (user) {
      return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
    });

    let project = await Projects.findOneAsync(approve.projectId);

    let module = approve.moduleId ? await Modules.findOneAsync(approve.moduleId) : null;

    let releaseFor = module ? (project && project.name || 'REMOVED_PROJECT')+' / '+(module.name || '') :
      (project && project.name || 'REMOVED_PROJECT');
    let releaseComment = approve.rejected ? 'Comment was: ' + approve.rejectedReason : '';

    for (const oneUser of users) {
      let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
      const userMailBody =
        '<p>Dear ' + escapeHtml(userName) + '!</p>' +
        '<p>Release for '+ escapeHtml(releaseFor) +' was ' +escapeHtml((approve.approved ? 'approved':'rejected')) +'</p>' +
        '<p>Release name is ' + escapeHtml(approve.name) + '</p>' +
        (approve.rejected ? '<p>' + escapeHtml(releaseComment) + '</p>' : '') +
        mailFooter();
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      if(EVENTS_BY_EMAIL){
        await Meteor.callAsync('_sendEmail',
          userName,
          'Release for ' + releaseFor +' was ' + (approve.approved ? 'approved':'rejected'),
          userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: approve.companyId,
        approveId: approve._id,
        projectId: project && project._id,
        moduleId: module ? module._id : null,
        message: 'Release: '+ approve.name +' for: '+releaseFor+ ' was ' + (approve.approved ? 'approved ':'rejected ')+ releaseComment,
        type: 'eventsApprovals',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    if(approve.approved){
      let followers = [];
      if((project && project.relatedUsers && project.relatedUsers.followers) ||
        (module && module.relatedUsers && module.relatedUsers.followers)) {
        let userList = (project && project.relatedUsers && project.relatedUsers.followers || [])
          .concat((module && module.relatedUsers && module.relatedUsers.followers || []));
        const allUsersN = await fetchUsersInRole(UserExtUtils.availableRolesKeys(), user.profile.companyId);
        followers = allUsersN.filter(u => userList.includes(u._id));

        followers = _.filter(followers, function (item) {
          return !_.any(users, function (user) {
            return user._id === item._id
          })
        });
        followers = followers.filter(function (user) {
          return Utils.isUserNotificationAllowed(user, ['EVENTS_ALL','EVENTS_APPROVES'])
        });
      }

      for (const oneUser of followers) {
        let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
        const userMailBody =
          '<p>Dear ' + escapeHtml(userName) + '!</p>' +
          '<p>You have decided to follow '+ escapeHtml(releaseFor) +'</p>' +
          '<p>We send you this mail to inform you about a new release ('+ escapeHtml(approve.name) +') that has been provided ' +
          'and declared compliant</p>' +
          mailFooter();
        let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
        if(EVENTS_BY_EMAIL){
          await Meteor.callAsync('_sendEmail',
            userName,
            'Updates in project ' + (project && project.name || 'REMOVED_PROJECT'),
            userMailBody,
            true);
        }
        let inboxMessage = {
          userId: oneUser._id,
          companyId: project.companyId,
          approveId: approve._id,
          projectId: project._id,
          moduleId: module ? module._id : null,
          message: 'New release: '+approve.name+ ' has been provided and declared compliant in ' + releaseFor,
          type: 'eventsApprovals',
          senderId: sender && sender._id,
          senderName: getUserName(sender)
        };
        await Meteor.callAsync('Messages.Create',inboxMessage);
      }
    }
    return true;
  },
   
  notifyAboutComponentImpact: async function (user, impactData) {
    const sender =  await Meteor.userAsync();
    if (!user || user && !await Roles.userIsInRoleAsync(user, ['portfolio_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    for (const project of impactData.list) {
      const users = []
      if(project.relatedUsers && project.relatedUsers.defaultComplianceManager){
        users.push(project.relatedUsers.defaultComplianceManager)
      }
      if(project.relatedUsers && project.relatedUsers.defaultProjectManager){
        users.push(project.relatedUsers.defaultProjectManager)
      }
      for (const oneUser of users) {
        let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
        for (const module of project.modules) {
          let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
          const title = 'Action required: Please review ' + (project && project.name || 'REMOVED_PROJECT') + '/'+ module.name +
            ' might be impacted by ' + impactData.component.name + ' vulnerability'
          if(EVENTS_BY_EMAIL){
            const userMailBody =
              '<p>Dear ' + escapeHtml(userName) + '!</p>' +
              '<p>Please be notified,  that your '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +
              '/'+ escapeHtml(module.name) +' contains ' + escapeHtml(impactData.component.name) +
              ' which has been identified to carry a severe vulnerability.</p>' +
              '<p>Please take appropriate action to ensure no harm will occur through this vulnerability</p>' +
              mailFooter();
            await Meteor.callAsync('_sendEmail',
              userName,
              title,
              userMailBody,
              true);
          }
          let inboxMessage = {
            userId: oneUser._id,
            companyId: impactData.companyId,
            projectId: project._id,
            moduleId: module ? module._id : null,
            componentKey: impactData.component.key,
            message: title,
            type: 'vulnerabilityIntroduced',
            senderId: sender && sender._id,
            senderName: getUserName(sender)
          };
          await Meteor.callAsync('Messages.Create',inboxMessage);
        }
      }
    }
    return true;
  },
   
  notifyAboutCveImpact: async function (user, impactData) {
    const sender =  await Meteor.userAsync();
    if (!user || user && !await Roles.userIsInRoleAsync(user, ['portfolio_manager'], user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    for (const project of impactData.list) {
      const users = []
      if(project.relatedUsers && project.relatedUsers.defaultComplianceManager){
        users.push(project.relatedUsers.defaultComplianceManager)
      }
      if(project.relatedUsers && project.relatedUsers.defaultProjectManager){
        users.push(project.relatedUsers.defaultProjectManager)
      }
      for (const oneUser of users) {
        let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
        for (const module of project.modules) {
          let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
          const title = 'Action required: Please review ' + (project && project.name || 'REMOVED_PROJECT') + '/'+ module.name +
            ' might be impacted by ' + impactData.cveDetails.name + ' vulnerability'
          if(EVENTS_BY_EMAIL){
            const userMailBody =
              '<p>Dear ' + escapeHtml(userName) + '!</p>' +
              '<p>Please be notified,  that your '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +
              '/'+ escapeHtml(module.name) +' contains ' + escapeHtml(impactData.cveDetails.name) +
              ' which has been identified to carry a severe vulnerability.</p>' +
              '<p>Please take appropriate action to ensure no harm will occur through this vulnerability</p>' +
              mailFooter();
            await Meteor.callAsync('_sendEmail',
              userName,
              title,
              userMailBody,
              true);
          }
          let inboxMessage = {
            userId: oneUser._id,
            companyId: impactData.companyId,
            projectId: project._id,
            moduleId: module ? module._id : null,
            message: title,
            type: 'vulnerabilityIntroduced',
            senderId: sender && sender._id,
            senderName: getUserName(sender)
          };
          await Meteor.callAsync('Messages.Create',inboxMessage);
        }
      }
    }
    return true;
  },
   
  notifyAboutAlgorithmsImpact: async function (user, impactData) {
    const sender =  await Meteor.userAsync();
    if (!user || user && !await Roles.userIsInRoleAsync(user, ['portfolio_manager', 'compliance_manager', 'company_security_manager'],
      user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    for (const project of impactData.list) {
      const users = []
      if(project.relatedUsers && project.relatedUsers.defaultComplianceManager){
        users.push(project.relatedUsers.defaultComplianceManager)
      }
      if(project.relatedUsers && project.relatedUsers.defaultProjectManager){
        users.push(project.relatedUsers.defaultProjectManager)
      }
      for (const userId of _.unique(users,'_id')) {
        let oneUser = await Meteor.users.findOneAsync(userId);
        let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
        for (const module of project.modules) {
          let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
          const title = 'Action required: Please review ' + (project && project.name || 'REMOVED_PROJECT') + '/'+ module.name +
            ' might be impacted by ' + impactData.algorithms.join(', ') + ' algorithms'
          if(EVENTS_BY_EMAIL){
            const userMailBody =
              '<p>Dear ' + escapeHtml(userName) + '!</p>' +
              '<p>Please be notified,  that your '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +
              '/'+ escapeHtml(module.name) +' contains ' + escapeHtml(impactData.algorithms.join(', ')) +
              ' algorithms.</p>' +
              '<p>Please take appropriate action to ensure no harm will occur through this algorithms</p>' +
              mailFooter();
            await Meteor.callAsync('_sendEmail',
              userName,
              title,
              userMailBody,
              true);
          }
          let inboxMessage = {
            userId: oneUser._id,
            companyId: impactData.companyId,
            projectId: project._id,
            moduleId: module ? module._id : null,
            message: title,
            type: 'alarmsNotifications',
            senderId: sender && sender._id,
            senderName: getUserName(sender)
          };
          await Meteor.callAsync('Messages.Create',inboxMessage);
        }
      }
    }
    return true;
  },
   
  notifyAboutEndoflifeImpact: async function (user, impactData) {
    const sender =  await Meteor.userAsync();
    if (!user || user && !await Roles.userIsInRoleAsync(user, ['portfolio_manager', 'compliance_manager', 'company_security_manager'],
      user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    for (const item of impactData.list) {
      for (const path of item.paths) {
        const users = []
        const project = await Projects.findOneAsync(path.projectId, {fields: {relatedUsers: 1, name: 1}});
        if(project.relatedUsers && project.relatedUsers.defaultComplianceManager){
          users.push(project.relatedUsers.defaultComplianceManager)
        }
        if(project.relatedUsers && project.relatedUsers.defaultProjectManager){
          users.push(project.relatedUsers.defaultProjectManager)
        }
        for (const userId of _.unique(users,'_id')) {
          let oneUser = await Meteor.users.findOneAsync(userId);
          let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
          let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
          const title = 'Action required: Please review ' + (project && project.name || 'REMOVED_PROJECT')  +
            ` contains ${item.key} ${item.versions} impacted by end-of-life policy expiration`
          if(EVENTS_BY_EMAIL){
            const userMailBody =
              '<p>Dear ' + escapeHtml(userName) + '!</p>' +
              '<p>Please be notified that your '+ escapeHtml((project && project.name || 'REMOVED_PROJECT')) +
              ` contains ${escapeHtml(item.key)} ${escapeHtml(item.versions)}` +
              ' impacted by end-of-life policy expiration.</p>' +
              '<p>Please take appropriate action to ensure no harm will occur through this component version</p>' +
              mailFooter();
            await Meteor.callAsync('_sendEmail',
              userName,
              title,
              userMailBody,
              true);
          }
          let inboxMessage = {
            userId: oneUser._id,
            companyId: impactData.companyId,
            moduleId: path.moduleId,
            projectId: path.projectId,
            componentKey: item.key,
            message: title,
            type: 'alarmsNotifications',
            senderId: sender && sender._id,
            senderName: getUserName(sender)
          };
          await Meteor.callAsync('Messages.Create',inboxMessage);
        }
      }
    }
    return true;
  },
   
  notifyAboutSuperUser: async function () {
    const sender =  await Meteor.userAsync();
    const users = await Meteor.callAsync('getUsersAccountAdmins', sender)

    for (const oneUser of users) {
      let userName = (oneUser.profile && oneUser.profile.email) || (oneUser.emails && oneUser.emails[0].address);
      let EVENTS_BY_EMAIL = Utils.isUserNotificationAllowed(oneUser, 'EVENTS_BY_EMAIL');
      const title = 'New superUser introduced'
      if(EVENTS_BY_EMAIL){
        const userMailBody =
          '<p>Dear ' + escapeHtml(userName) + '!</p>' +
          '<p>Please be notified, that in your company superUser introduced</p>' +
          '<p>All compliance procedures live from shared responsibilities. ' +
          'This overrules the shared responsibility model. It has been invented just for testing purposes!\'</p>' +
          mailFooter();
        await Meteor.callAsync('_sendEmail',
          userName,
          title,
          userMailBody,
          true);
      }
      let inboxMessage = {
        userId: oneUser._id,
        companyId: sender.profile.companyId,
        message: title,
        type: 'superUserIntroduced',
        senderId: sender && sender._id,
        senderName: getUserName(sender)
      };
      await Meteor.callAsync('Messages.Create',inboxMessage);
    }
    return true;
  }
});



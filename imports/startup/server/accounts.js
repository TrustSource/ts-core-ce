import {Meteor} from 'meteor/meteor';
import {Accounts} from 'meteor/accounts-base';
import {Match, check} from 'meteor/check';
import {Roles} from 'meteor/alanning:roles';
import logEvent from '/imports/server/logEvent';
import Companies from '/imports/lib/collections/companies';
import {Config} from '/imports/server/config';
import {Config as AppConfig} from '/imports/config';
import {escapeHtml} from '/imports/lib/html/tableCells';
import {mailFooter, supportContact} from '/imports/server/mail/footer';
import {accountStatusOf, ACCOUNT_STATUS} from '/imports/lib/accountStatus';
import {userDisplayName, userRealName, userAccountName} from '/imports/lib/user/displayName';
import {rolesForNewUser, legacyRolesToMigrate, COMPANY_OWNER_ROLES} from '/imports/server/userRoles';
import {withoutServerOnlyProfileFlags} from '/imports/lib/interactors/users/protectedProfileFields';
import {userNameProblem, normalizeUserName, USER_NAME_MESSAGES} from '/imports/lib/user/nameValidation';

const USER_NF = 'User not found'
const USER_AiC = 'User is already in company'

// Set only by trusted server-side flows (admin invitations) that legitimately
// attach a new account to an EXISTING company. onCreateUser consults it to decide
// whether a client-supplied profile.companyId may be honored - without it, an
// unauthenticated DDP `createUser` call could plant an account (with default
// admin roles) inside an arbitrary victim company.
export const trustedCompanyAssignment = new Meteor.EnvironmentVariable();

// True when a client-supplied profile.companyId must NOT be honored. It is only
// trusted for admin invitations (which run inside trustedCompanyAssignment).
function isUntrustedClientCompanyId(user) {
  return !!(user.profile && user.profile.companyId) && !trustedCompanyAssignment.get();
}

// (server-side)
Meteor.startup(async function () {

  // loginExpirationInDays: minimum 0.05 = 1.2 hours / 1 = 24 hours / default 90 days.
  // forbidClientAccountCreation turns off the client createUser method only;
  // invitations create accounts on the server.
  Accounts.config({ loginExpirationInDays: 1, forbidClientAccountCreation: !Config.REGISTRATION_ENABLED });
  Accounts.emailTemplates.from = Config.MAIL_SENDER;
  Accounts.emailTemplates.siteName = AppConfig.name;

  // Encode tokens in email URLs to prevent '=' from breaking quoted-printable encoding
  Accounts.urls.enrollAccount = function(token) {
    return Meteor.absoluteUrl('#/enroll-account/' + encodeURIComponent(token));
  };
  Accounts.urls.resetPassword = function(token) {
    return Meteor.absoluteUrl('#/reset-password/' + encodeURIComponent(token));
  };

  // A Function that takes a user object and returns a String for the subject line of the email.
  Accounts.emailTemplates.verifyEmail.subject = function () {
    return 'Confirm Your Email Address';
  };
  //
  // // Configures "enroll account" email link
  // Accounts.urls.enrollAccount = function(token){
  //   return Meteor.absoluteUrl("enroll-account/" + token);
  // };
  //
  // // Configures "verify email" email link
  // Accounts.urls.verifyEmail = function(token){
  //   return Meteor.absoluteUrl("verify-email/" + token);
  // };

  const CLICK_TRACKING = '" clicktracking=off>'

  // A Function that takes a user object and a url, and returns the body text for the email.
  // Note: if you need to return HTML instead, use Accounts.emailTemplates.verifyEmail.html
  Accounts.emailTemplates.verifyEmail.html = function (user, url) {
    // Never log `url`: it carries the verification token.
    console.log('Generating verifyEmail mail for user', user._id);
    return '<p>Dear ' + escapeHtml(userDisplayName(user)) + '!</p>' +
      '<p>You receive this email because your email address was registered for an account ' +
      'at ' + escapeHtml(AppConfig.name) + '.</p>' +
      '<p>If you did not request this, please ' + supportContact() + ' or ignore this mail.</p>' +
      '<p>If you intended to open an account please click this link: <a href="' + escapeHtml(url) + CLICK_TRACKING + escapeHtml(url) + '</a> ' +
      'to  verify your mail address and activate the account. ' +
      'Activation will happen directly and you may login immediately.</p>' +
      mailFooter();
  };

  // A Function that takes a user object and a url, and returns the body text for the email.
  // Note: if you need to return HTML instead, use Accounts.emailTemplates.resetPassword.html
  // Possible commands Accounts.emailTemplates.{enrollAccount|resetPassword|verifyEmail}.html
  Accounts.emailTemplates.resetPassword.html = function (user, url) {
    // Never log `url`: it carries the password-reset token.
    console.log('Generating resetPassword mail for user', user._id);
    return '<p>Dear ' + escapeHtml(userDisplayName(user)) + '!</p>' +
      '<p>You receive this email because a password reset was requested for an email address that is ' +
      'registered for an account at ' + escapeHtml(AppConfig.name) + '.</p>' +
      '<p>If you did not request this, please ' + supportContact() + ' or ignore this mail.</p>' +
      '<p>Please click this link: <a href="' + escapeHtml(url) + CLICK_TRACKING + escapeHtml(url) + '</a> to set new the password.</p>' +
      mailFooter();
  };

  // A Function that takes a user object and a url, and returns the body text for the email.
  // Note: if you need to return HTML instead, use Accounts.emailTemplates.enrollAccount.html
  // Possible commands Accounts.emailTemplates.{enrollAccount|resetPassword|verifyEmail}.html
  Accounts.emailTemplates.enrollAccount.html = async function (user, url) {
    // Never log `url`: it carries the enrolment token.
    console.log('Generating enrollAccount mail for user', user._id);
    const inviter = await Meteor.users.findOneAsync({_id: user.profile.invitedBy});
    const company = await Companies.findOneAsync({_id: inviter.profile.companyId});
    const userScopes = await Roles.getScopesForUserAsync(user);
    const firstCompany = userScopes.length <= 1;
    let description = '';
    if (company && inviter) {
      description += '<p>' + escapeHtml(inviter.profile.name) + ' (' + escapeHtml(company.name) + ') ' +
        'has invited you to work jointly with him/her on the open source risk management of your applications.</p>'
    }
    if (firstCompany) {
      description += '<p>Please click on the following link to activate your account:</p>' +
        '<p><a href="' + escapeHtml(url) + CLICK_TRACKING + escapeHtml(url) + '</a></p>'
    }else {
      description += '<p>Please click on the following link to enter your account:</p>' +
        '<p><a href="' + escapeHtml(AppConfig.appUrl) + '">' + escapeHtml(AppConfig.appUrl) + '</a></p>'
    }
    return '<p>Hello ' + escapeHtml(userDisplayName(user)) + '!</p>' +
      description +
      mailFooter();
  };
});

// Named export so the account-status gate can be unit-tested directly.
export async function validateLoginAttempt(attempt) {
  await Meteor.callAsync('LoginsHistory.Create', attempt)
  // Let 2FA errors pass through to the client unchanged
  if (attempt.error && attempt.error.error === 'no-2fa-code') {
    throw attempt.error;
  }
  if (attempt.error && attempt.error.error === 'invalid-2fa-code') {
    throw attempt.error;
  }
  // Suspension gate: a suspicious/suspended account has NO platform
  // access. This fires for ALL attempt types (incl. 'resume'), AFTER the 2FA
  // pass-through and BEFORE the email-verified check. Throw a distinct
  // error (rather than a bare `return false`) so the login screen can show a
  // clear reason instead of the generic "wrong credentials" message. This branch
  // is only reachable AFTER valid credentials (attempt.user is resolved), so it
  // is not an anonymous account status oracle. accountStatus is read-only here; only the
  // external admin app writes it (from another process).
  if (attempt.user && accountStatusOf(attempt.user) !== ACCOUNT_STATUS.ACTIVE) {
    throw new Meteor.Error('account-suspended',
      'Your account has been suspended. Please contact your account administrator to restore access.');
  }
  if (attempt.user && attempt.user.emails && !attempt.user.emails[0].verified) {
    console.log('email not verified');
    return false; // the login is aborted
  }
  return attempt.allowed;
}

Accounts.validateLoginAttempt(validateLoginAttempt);

async function createNewCompany (user) {
  let createdCompanyId = await Companies.insertAsync({
    created: new Date(),
    name: undefined,
    apiKeys: []
  });
  await logEvent(user, 'New company created', 'companyCreation');
  if(!user.profile || user.profile && !user.profile.companyId){
    // Try to update existing user (works when called from onLogin)
    const updated = await Meteor.users.updateAsync(user._id,{$set: {'profile.companyId': createdCompanyId}});
    if (updated > 0) {
      // User exists in DB - assign roles via Roles v4 API
      await Roles.setUserRolesAsync(user._id, COMPANY_OWNER_ROLES, {scope: createdCompanyId});
    } else {
      // User doesn't exist yet (called from onCreateUser) - store pending roles
      user._pendingRoles = {companyId: createdCompanyId, roles: COMPANY_OWNER_ROLES};
    }
    user.profile.companyId = createdCompanyId;
  }
  return createdCompanyId
}

Accounts.onLogin(async function(data){
  if(data.user && !data.user.profile || (data.user.profile && !data.user.profile.companyId)){
    await createNewCompany(data.user)
  }
});


// Deferred registration finalizer: the Meteor.setTimeout body of onCreateUser
// (roles assignment, registration mails, company compensation), so specs can
// drive the mail branches directly without real timers.
export async function finalizeRegistration({user, createdCompanyId, isPasswordService, pendingRoles}) {
  const dbUser = await Meteor.users.findOneAsync(user._id);

  // Assign roles via Roles v4 API after user is in DB
  if (dbUser && pendingRoles) {
    try {
      await Roles.setUserRolesAsync(user._id, pendingRoles.roles, {scope: pendingRoles.companyId});
      // Clean up temp field
      await Meteor.users.updateAsync(user._id, {$unset: {_pendingRoles: 1}});
    } catch (e) {
      console.error('Failed to assign roles for user', user._id, e);
    }
  }

  // PasswordService and user successfully created, send e-mails
  if (dbUser && isPasswordService) {
    // send invitation or verification message. Must await:
    // these are async in Meteor 3 and this runs in a fire-and-forget
    // setTimeout, so an unawaited failure becomes an unhandled rejection.
    // Catch + log instead.
    try {
      if (user.profile && user.profile.invitedBy) {
        console.log('sendEnrollmentEmail: userId=', user._id);
        await Accounts.sendEnrollmentEmail(user._id);
      } else {
        console.log('sendVerificationEmail: userId=', user._id);
        await Accounts.sendVerificationEmail(user._id);
      }
    } catch (e) {
      console.error('Failed to send enrollment/verification email for user', user._id, e && e.message);
    }
    // A self-service registration has no profile.name, so naming the user and then repeating
    // the address rendered "New user created x@y.com (x@y.com)". Only pair them up when there
    // really is a name to pair.
    const createdName = userRealName(user);
    const createdAccount = userAccountName(user) || user.profile.email;
    await logEvent(dbUser, 'New user created '
      + (createdName ? createdName + ' (' + createdAccount + ')' : createdAccount), 'userCreated');
  }
  // compensation: if we created the company, but the user doesn't appear}
  if (!dbUser && createdCompanyId) {
    console.log('User not found, remove company: ', user._id, createdCompanyId);
    await Companies.removeAsync(createdCompanyId);
  }
}

// Redact the credential before logging: server-originated createUser calls
// carry the PLAINTEXT password in options (client DDP sends a hashed digest,
// still sensitive). Shallow copy only - never mutates the real options.
function redactCreateUserOptions(options) {
  if (options && options.password) {
    return Object.assign({}, options, {password: '[redacted]'});
  }
  return options;
}

Accounts.onCreateUser(async function (options, user) {
  console.log('onCreateUser: ', {_id: user._id, createdAt: user.createdAt}, 'options: ', redactCreateUserOptions(options));
  let createdCompanyId;
  let isPasswordService;

  // default hook's profile behavior
  if (options.profile) {
    user.profile = options.profile;
  } else {
    user.profile = {};
  }
  // `testuser` and `invitedBy` are markers only server flows may set. From a
  // client sign-up, testuser skipped company assignment and e-mail verification
  // (and the companyId strip below), invitedBy swapped the verification mail for an
  // invitation. Admin invitations run inside trustedCompanyAssignment and keep them.
  if (!trustedCompanyAssignment.get()) {
    user.profile = withoutServerOnlyProfileFlags(user.profile);
  }

  if (user.profile && user.profile.testuser) {
    // skip all further steps for users created by fixture
    if (user.emails && user.emails[0]) {
      user.emails[0].verified = true;
    }
    return user;
  }

  let pendingRolesList = rolesForNewUser(options, user);

  /**
   * Password Service
   * user.services.password is not set, if user created for invitation
   */
  if (user && (user.services && user.services.password || (user.profile && user.profile.invitedBy))) {
    user.profile.email = options.email;
    isPasswordService = true;
  }

  // SECURITY: prevent cross-tenant account injection. A client (DDP) caller must
  // not attach the new account to an arbitrary company via profile.companyId.
  // Drop an untrusted companyId so the block below creates a fresh company this
  // user owns, and ignore any client-supplied role hints. (See helper above.)
  if (isUntrustedClientCompanyId(user)) {
    delete user.profile.companyId;
    pendingRolesList = ['manager', 'account_admin'];
  }

  // Create the company AFTER all service-specific profile fields (email, login, name)
  // are populated, so the sales notification email and logEvent inside
  // createNewCompany see the real address rather than `undefined`.
  if (!user.profile || (user.profile && !user.profile.companyId)) {
    createdCompanyId = await createNewCompany(user)
    user.profile.companyId = createdCompanyId
  }

  // Store pending roles for assignment after user creation
  if (!user._pendingRoles && user.profile && user.profile.companyId && pendingRolesList) {
    user._pendingRoles = {companyId: user.profile.companyId, roles: pendingRolesList};
  }

  // asynchronous cleanup
  const pendingRoles = user._pendingRoles;
  if (createdCompanyId || isPasswordService || pendingRoles) {
    Meteor.setTimeout(function () {
      finalizeRegistration({
        user: user,
        createdCompanyId: createdCompanyId,
        isPasswordService: isPasswordService,
        pendingRoles: pendingRoles
      }).catch((e) => console.error('finalizeRegistration failed', user._id, e));
    }, 5 * 1000);
  }

  return user;
});

Meteor.methods({
  hasPasswordService: async function () {
    if (!this.userId) return false;
    const user = await Meteor.users.findOneAsync(this.userId, {fields: {'services.password': 1}});
    return !!(user && user.services && user.services.password);
  },

  resetUserPassword: async function (email) {
    // email reaches a Mongo selector - must be a string, else {$ne:null}
    // matches an arbitrary user and triggers a reset on their account. This
    // guard is OUTSIDE the try below so it is never swallowed by the
    // anti-enumeration containment (it is the only error that may escape).
    if (typeof email !== 'string') {
      throw new Meteor.Error(400, 'Invalid email');
    }
    try {
      // The same address can live on more than one doc: a CANONICAL doc (address
      // in emails[], usually with services.password) and one or more STRAY docs
      // (address only in profile.email/username, e.g. an invited user). A plain
      // findOneAsync($or) could return the stray; backfilling its emails[] from
      // profile.email then collides with the canonical's value on the unique
      // emails.address_1 index (E11000 -> 500). Fetch ALL candidates and
      // deterministically pick the canonical owner instead.
      const candidates = await Meteor.users.find({$or: [
        {'emails.address': email},
        {'profile.email': email},
        {'username': email}
      ]}).fetchAsync();
      if (!candidates.length) {
        // Anti-enumeration: do NOT reveal whether an account exists. Return as if
        // successful (the client shows the same "check your email" message) and
        // don't log the probed address.
        console.log('Password reset requested for an unknown address');
        return;
      }
      // Owners already hold the address in emails[] - prefer the one with a
      // password service, then any owner, then fall back to the first candidate.
      const owners = candidates.filter(u => Array.isArray(u.emails) && u.emails.some(e => e.address === email));
      let target = owners.find(u => u.services && u.services.password) || owners[0] || candidates[0];

      if (owners.indexOf(target) === -1) {
        // target is a stray (no emails[] entry for this address). Before writing,
        // make sure no OTHER doc already owns the address, else the backfill would
        // collide on the unique index regardless of $or ordering.
        const otherOwner = await Meteor.users.findOneAsync({_id: {$ne: target._id}, 'emails.address': email});
        if (otherOwner) {
          target = otherOwner;
        } else if (target.profile && target.profile.email) {
          // Invited-only user with no other owner: safe to backfill emails[].
          // Seed from the doc's OWN stored email, never the client-supplied value.
          await Meteor.users.updateAsync(target._id, {$set: {emails: [{address: target.profile.email, verified: false}]}});
        }
        // No profile.email and no other owner: degrade to success-shaped (a
        // 'no email on record' throw here would be an enumeration oracle).
      }

      const targetId = target._id;
      // Send asynchronously: awaiting the email send here made the known-address
      // branch ~800ms slower than the immediate unknown-address return, leaking
      // account existence via response timing. Defer so both branches return alike.
      Meteor.defer(async function () {
        try {
          await Accounts.sendResetPasswordEmail(targetId);
          await logEvent(target, 'Password reset sent to ' + email, 'emailReset');
        } catch (e) {
          console.error('sendResetPasswordEmail failed:', e.message);
        }
      });
    } catch (e) {
      // Anti-enumeration containment: a unique-index collision (E11000) or any
      // other failure must NOT reach the client as a 500 (it would distinguish
      // the known/collision path from the unknown path). Swallow silently and
      // return success-shaped. NEVER interpolate `email` into logs.
      if (!(e && e.code === 11000)) {
        console.error('resetUserPassword failed:', e && e.message);
      }
      return;
    }
  },

  verifyUserPassword: async function (token, digest) {
    // Do NOT log `token`/`digest`: the digest is a password-equivalent
    // ({digest, algorithm} authenticates the user) and the token enables
    // account actions - logging them leaks credentials to server logs.
    // token/digest reach Mongo selectors / password check - must be strings
    // (otherwise {$ne:null} matches an arbitrary user - operator injection).
    if (!this.userId && (typeof token !== 'string' || typeof digest !== 'string')) {
      throw new Meteor.Error(400, 'Invalid token');
    }
    const user = this.userId ? await Meteor.userAsync() : await Meteor.users.findOneAsync({
      'services.email.verificationTokens': {
        '$elemMatch': {
          token: token
        }
      }
    });
    if (user) {
      const password = {digest: digest, algorithm: 'sha-256'};
      const result = await Accounts._checkPasswordAsync(user, password);
      if(!result.error && user.profile && user.profile.companyId){
        // Migrate pre-Roles-v4 flat roles into the company scope. Only real
        // legacy roles: an account without them gets none, so holding a
        // companyId alone never makes an account a member of that company.
        const existingRoles = await Roles.getRolesForUserAsync(user, {scope: user.profile.companyId});
        const legacyRoles = legacyRolesToMigrate(user);
        if (existingRoles.length === 0 && legacyRoles.length > 0) {
          await Roles.setUserRolesAsync(user._id, legacyRoles, {scope: user.profile.companyId});
        }
      }
      // Never log the full user object (contains services.password.bcrypt and
      // reset tokens) or the digest. Log only a non-sensitive identifier.
      console.log('verifyUserPassword result for', user._id, !result.error);
      let userEmail = ((user.profile && user.profile.email)
      || (user.emails && user.emails[0] && user.emails[0].address || user.profile.email));
      await logEvent(user, 'eMail verified ' + userEmail, 'emailVerification');
      return !result.error;
    }
    throw new Meteor.Error(USER_NF, USER_NF);
  },

  getUserInfoByToken: async function (token) {
    // Do NOT log `token` - reset/enroll/verification tokens enable account
    // takeover if leaked to server logs.
    // token reaches a Mongo selector - must be a string, else {$ne:null}
    // returns an arbitrary user's profile/company (operator injection).
    if (typeof token !== 'string') {
      throw new Meteor.Error(400, 'Invalid token');
    }
    // Meteor 3 stores enrollment tokens at services.password.enroll,
    // reset tokens at services.password.reset
    let user = await Meteor.users.findOneAsync({
      'services.password.reset.token': token
    }, {fields: {profile: true}});
    if (!user) {
      user = await Meteor.users.findOneAsync({
        'services.password.enroll.token': token
      }, {fields: {profile: true}});
    }
    if (!user) {
      user = await Meteor.users.findOneAsync({
        'services.email.verificationTokens.token': token
      }, {fields: {profile: true}});
    }
    console.log('getUserByToken found', user ? user._id : 'not found');

    if (user && user.profile && user.profile.companyId) {
      // This method is allowlisted as a pre-login flow (invitation accept), so
      // it must NOT ship company secrets. The accept-invitation UI only needs
      // the company name - use an INCLUSION projection so apiKeys,
      // externalApiKeys and integration credentials can never leak here.
      user.company = await Companies.findOneAsync(user.profile.companyId, {fields: {name: 1}});
    }
    return user;
  },

  resetPasswordByToken: async function (token) {
    // token reaches a Mongo selector - must be a string, else {$ne:null}
    // matches an arbitrary user and triggers a reset on their account.
    if (typeof token !== 'string') {
      throw new Meteor.Error(400, 'Invalid token');
    }
    let user = await Meteor.users.findOneAsync({
      $or: [{'services.password.reset.token': token},
        {'services.password.enroll.token': token},
        {'services.email.verificationTokens.token': token}]
    }, {fields: {profile: true}});
    if (!user) {
      throw new Meteor.Error(404, 'Invalid token');
    }
    Meteor.defer(function () {
      Accounts.sendResetPasswordEmail(user._id);
    });
  },

  inviteUser: async function (name, email, role) {
    const user = await Meteor.userAsync();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    //console.log('inviteUser', name, email);
    if (!emailRegex.test(email)) {
      throw new Meteor.Error(400, 'Email address is invalid');
    }
    if (!user || !await Roles.userIsInRole(user, 'account_admin', user.profile.companyId)) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    if (!user.profile || !user.profile.companyId) {
      throw new Meteor.Error(500, 'No company defined');
    }
    const NonEmptyString = Match.Where(function (x) {
      check(x, String);
      return x.length > 0;
    });

    // Before check(): an empty name failed it with a bare "Match failed", and a
    // whitespace-only name passed it and became the new user's profile.name.
    const nameProblem = userNameProblem(name);
    if (nameProblem) {
      throw new Meteor.Error(400, USER_NAME_MESSAGES[nameProblem]);
    }
    name = normalizeUserName(name);
    check(name, NonEmptyString);
    check(email, NonEmptyString);

    let newUser = await Meteor.users.findOneAsync({$or: [{'emails.address': email}, {'profile.email': email}, {'username': email}]});
    const newRoles = Array.isArray(role) ? role : [(role||'developer')];
    let isUserInCompany = false;
    if (newUser) {
      const existingRoles = await Roles.getRolesForUserAsync(newUser, {scope: user.profile.companyId});
      isUserInCompany = existingRoles.length > 0;
    }
    let res;
    if(isUserInCompany){
      throw new Meteor.Error(USER_AiC, USER_AiC);
    }else{
      await logEvent(user, 'New user invited '+ name + ' (' + email + ')', 'userInvitation');
      if (newUser){
        let userUpdates = {
          'profile.invitedBy':user._id
        };
        if (!newUser.profile.name){
          userUpdates['profile.name'] = name
        }
        // Check if user has no company set
        const userScopes = await Roles.getScopesForUserAsync(newUser);
        if(userScopes.length === 0){
          userUpdates['profile.companyId'] = user.profile.companyId
        }
        res = await Meteor.users.updateAsync(newUser._id, {$set: userUpdates});
        // Assign roles via Roles v4 API
        await Roles.setUserRolesAsync(newUser._id, newRoles, {scope: user.profile.companyId});
        await Meteor.callAsync('resendEnrollmentEmail', email, newUser)
      }else{
        // Trusted: an authenticated admin is inviting into their OWN company, so
        // allow onCreateUser to honor the companyId set here.
        res = await trustedCompanyAssignment.withValue(true, async () => Accounts.createUser({
          email: email,
          roles: newRoles,
          profile: {
            name: name,
            companyId: user.profile.companyId,
            email: email,
            notifications : [
              'EVENTS_ALL',
              'ALARMS_ALL',
              'NEWS_GENERAL',
              'NEWS_PROMO',
              'NEWS_EACG'
            ],
            invitedBy: user._id
          }
        }));
        // Assign roles after user creation
        if (res) {
          await Roles.setUserRolesAsync(res, newRoles, {scope: user.profile.companyId});
        }
      }
    }
    return res ? 'ok' : 'error';
  },

  resendEnrollmentEmail: async function (email, user) {
    if (typeof email !== 'string') {
      throw new Meteor.Error(400, 'Invalid email');
    }
    // A client call (also when nested in inviteUser) must come from an account
    // admin; the target must belong to that admin's company (checked below).
    let callerCompanyId = null;
    if (this.connection) {
      const caller = await Meteor.userAsync();
      callerCompanyId = caller && caller.profile && caller.profile.companyId;
      if (!callerCompanyId || !await Roles.userIsInRole(caller, 'account_admin', callerCompanyId)) {
        throw new Meteor.Error(403, 'Access Denied');
      }
    }
    // NEVER trust a client-supplied `user` object: it would let an attacker
    // target an arbitrary _id and overwrite that user's email (account
    // takeover). Re-resolve the target from the DB, and match the email as an
    // anchored, escaped, case-insensitive value (no unescaped $regex = ReDoS /
    // over-match).
    let target = null;
    if (user && typeof user._id === 'string') {
      target = await Meteor.users.findOneAsync(user._id);
    }
    if (!target) {
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const selector = {$regex: '^' + escaped + '$', $options: 'i'};
      // The same address can live on more than one doc (a CANONICAL doc with the
      // address in emails[] and one or more STRAY invited docs with it only in
      // profile.email). Resolve ALL candidates and deterministically prefer the
      // canonical owner, so the backfill below can never collide on the unique
      // emails.address_1 index (E11000). Match the address either in emails[]
      // (any verification state) or in profile.email - same anchored, escaped,
      // case-insensitive value (no unescaped $regex = ReDoS / over-match).
      const candidates = await Meteor.users.find({$or: [
        {emails: {$elemMatch: {address: selector}}},
        {'profile.email': selector}
      ]}).fetchAsync();
      const owners = candidates.filter(u => Array.isArray(u.emails)
        && u.emails.some(e => typeof e.address === 'string' && e.address.toLowerCase() === email.toLowerCase()));
      target = owners.find(u => u.services && u.services.password) || owners[0] || candidates[0] || null;
    }
    if (!target) {
      throw new Meteor.Error(USER_NF, USER_NF);
    }
    // An invited user from another company keeps their profile.companyId but holds
    // roles in the inviting company, so either one counts as membership.
    if (callerCompanyId && !(target.profile && target.profile.companyId === callerCompanyId)
      && (await Roles.getRolesForUserAsync(target._id, {scope: callerCompanyId})).length === 0) {
      throw new Meteor.Error(USER_NF, USER_NF);
    }
    // Invited users may only have profile.email and no emails[] entry. Seed it
    // from the user's OWN stored email - never from the client-supplied value.
    if (!target.emails || !target.emails.length) {
      const address = target.profile && target.profile.email;
      if (!address) {
        throw new Meteor.Error(400, 'User has no email address on record');
      }
      // Re-target if another doc already owns this address, else the backfill
      // would collide on the unique emails.address_1 index (any candidate
      // ordering). Match with the same anchored, escaped, case-insensitive value.
      const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const otherOwner = await Meteor.users.findOneAsync({
        _id: {$ne: target._id},
        emails: {$elemMatch: {address: {$regex: '^' + escapedAddress + '$', $options: 'i'}}}
      });
      if (otherOwner) {
        target = otherOwner;
      } else {
        try {
          await Meteor.users.updateAsync(target._id, {$set: {emails: [{address: address, verified: false}]}});
        } catch (e) {
          // Contain a unique-index collision as a CONTROLLED error: an admin must
          // never see a raw Mongo 500. Other backfill errors propagate.
          if (e && e.code === 11000) {
            throw new Meteor.Error(USER_NF, USER_NF);
          }
          throw e;
        }
      }
    }
    // Must await: Accounts.sendEnrollmentEmail is async in Meteor 3.
    await Accounts.sendEnrollmentEmail(target._id);
  }
});

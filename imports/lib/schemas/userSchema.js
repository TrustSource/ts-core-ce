import {BWLicenseEntrySchema, BWComponentEntrySchema} from './bwlistSchema';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {ACCOUNT_STATUS} from '/imports/lib/accountStatus';
import {USER_NAME_REGEX} from '/imports/lib/user/nameValidation';

// GitHub login was removed. `login` is still read; the other fields stay only
// because existing user documents still carry them.
const githubProfile = {
  // github login name
  login: {
    type: String,
    optional: true
  },
  // github avatar url
  avatar_url: {
    type: String,
    optional: true
  },
  // github api-url
  url: {
    type: String,
    optional: true
  },
  // github blog url
  blog: {
    type: String,
    optional: true
  },
  // github html url
  html_url: {
    type: String,
    optional: true
  },
  // github location
  location: {
    type: String,
    optional: true
  }
};

export const UserProfile = new SimpleSchema([{
  name: {
    type: String,
    // Single source of truth in imports/lib/user/nameValidation.js (also used by
    // the invite/import server methods and unit-tested there).
    regEx: USER_NAME_REGEX,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true,
    denyUpdate: true
  },
  email: {
    type: String,
    regEx: SimpleSchema.RegEx.Email,
    optional: true
  },
  locale: {
    type: String,
    optional: true,
    allowedValues: ['de', 'en']
  },
  theme: {
    type: String,
    optional: true,
    allowedValues: ['dark', 'light']
  },
  notifications: {
    type: [String],
    optional: true,
    allowedValues: [
      'NEWS_GENERAL',
      'NEWS_PROMO',
      'NEWS_EACG',
      'ALARMS_ALL',
      'ALARMS_COMPLIANCE',
      'ALARMS_VULNERABILITY',
      'ALARMS_ISSUES',
      'ALARMS_ENDOFLIFE',
      'ALARMS_BY_EMAIL',
      'EVENTS_ALL',
      'EVENTS_NEW',
      'EVENTS_CHANGES',
      'EVENTS_APPROVES',
      'EVENTS_BY_EMAIL'
    ]
  },
  invitedBy: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  testuser: {
    type: Boolean,
    optional: true
  },
  newsletter: {
    type: Boolean,
    optional: true
  }
}, githubProfile]);

const UserLicenseConfig = new SimpleSchema({
  whitelist: {
    type: [BWLicenseEntrySchema]
  },
  blacklist: {
    type: [BWLicenseEntrySchema]
  }
});

const UserComponentConfig = new SimpleSchema({
  whitelist: {
    type: [BWComponentEntrySchema]
  },
  blacklist: {
    type: [BWComponentEntrySchema]
  },
  unchanged: {
    type: [BWComponentEntrySchema]
  },
  looseCoupled: {
    type: [BWComponentEntrySchema]
  }
});

const userIntroConfig = new SimpleSchema({
  welcome: {
    type: Boolean,
    optional: true
  },
  demoProject: {
    type: Boolean,
    optional: true
  },
  componentManager: {
    type: Boolean,
    optional: true
  },
  securityManager: {
    type: Boolean,
    optional: true
  },
  // The AI chat was removed; kept only because existing user documents still carry this field.
  chat: {
    type: Boolean,
    optional: true
  }
});

export const UserSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  username: {
    type: String,
    regEx: /^\w{3,15}$/,
    optional: true
  },
  emails: {
    type: [Object],
    // this must be optional if you also use other login services like facebook,
    // but if you use only accounts-password, then it can be required
    optional: true
  },
  'emails.$.address': {
    type: String,
    regEx: SimpleSchema.RegEx.Email
  },
  'emails.$.verified': {
    type: Boolean
  },
  createdAt: {
    type: Date,
    optional: true
  },
  profile: {
    type: UserProfile,
    optional: true
  },
  services: {
    type: Object,
    optional: true,
    blackbox: true
  },
  // Add `roles` to your schema if you use the meteor-roles package.
  // Option 1: Object type
  // If you specify that type as Object, you must also specify the
  // `Roles.GLOBAL_GROUP` group whenever you add a user to a role.
  // Example:
  // Roles.addUsersToRoles(userId, ["admin"], Roles.GLOBAL_GROUP);
  // You can't mix and match adding with and without a group since
  // you will fail validation in some cases.
  // roles: {
  //    type: Object,
  //    optional: true,
  //    blackbox: true
  // },
  // Option 2: [String] type
  // If you are sure you will never need to use role groups, then
  // you can specify [String] as the type
  // roles: {
  //   type: [String],
  //   optional: true
  // },
  roles: {
    type: Object,
    optional: true,
    blackbox: true
  },
  licenseConfig: {
    type: UserLicenseConfig,
    optional: true
  },
  componentConfig: {
    type: UserComponentConfig,
    optional: true
  },
  intro: {
    type: userIntroConfig,
    optional: true
  },
  // --------------------------------------------------------------------------
  // Account-status contract - UPDATES remain locked in ts-app.
  //
  // These three top-level fields are written only by a SEPARATE admin app
  // (another process writing the shared DB). Declaring them here lets ts-app READ
  // them (clean() would otherwise strip unknown keys) and adds a top-level write
  // barrier: the `custom` validator fails any update MODIFIER that sets them.
  // It does not fire on INSERT. `accountClearing` is no longer written by
  // anything; it stays so existing documents validate.
  // This is defence-in-depth only - a blackbox sub-doc skips dotted
  // sub-path validation (e.g. {$set:{'accountClearing.score':9}}), so the
  // authoritative write-lock is the Meteor.users.updateAsync wrapper (update +
  // transitive upsert) in imports/server/collections/users.js. Do NOT use `denyUpdate` for the lock:
  // it is a dead no-op in this vendored simple-schema/collection2 (proof:
  // profile.companyId has denyUpdate:true above, yet changeCompany updates it in
  // prod at imports/server/collections/users.js).
  // --------------------------------------------------------------------------
  accountStatus: {
    type: String,
    optional: true,
    allowedValues: [ACCOUNT_STATUS.ACTIVE, ACCOUNT_STATUS.SUSPICIOUS, ACCOUNT_STATUS.SUSPENDED],
    custom() {
      if (this.isModifier && this.isSet) {
        return 'noWriteAccountStatus';
      }
    }
  },
  accountStatusInfo: {
    type: Object,
    optional: true,
    blackbox: true,
    custom() {
      if (this.isModifier && this.isSet) {
        return 'noWriteAccountStatus';
      }
    }
  },
  accountClearing: {
    type: Object,
    optional: true,
    blackbox: true,
    custom() {
      if (this.isModifier && this.isSet) {
        return 'noWriteAccountStatus';
      }
    }
  }
});


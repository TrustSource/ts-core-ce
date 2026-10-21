import {BWLicenseEntrySchema, BWComponentEntrySchema, BWCveEntrySchema} from './bwlistSchema';
import {AlgorithmsConfig} from './algorithmsSchema';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {ProductContactsSchema} from './productSchema';
import {EndoflifePolicy} from './endoflifePolicySchema';


const CompanyStatisticsEntry = new SimpleSchema({
  warnings: {
    type: Number
  },
  violations: {
    type: Number
  },
  total: {
    type: Number
  }
});

const apiKeyEntrySchema = new SimpleSchema({
  created: {
    type: Date,
    optional: true
  },
  key: {
    type: String
  },
  // Non-secret stable identity, generated once at creation, immutable - used by
  // apiKey.update/updateApiKeyByUser/apiKey.logActivity to find "this row" now
  // that the client no longer receives the secret `key` value to match on.
  id: {
    type: String,
    optional: true
  },
  // HMAC-SHA256(key) blind index - enables REST-auth lookup by presented
  // plaintext without an unindexed decrypt-and-compare scan. Never a new
  // disclosure risk on its own (not reversible to the key).
  keyHash: {
    type: String,
    optional: true
  },
  // Non-secret display string (first4...last4), computed once at creation so
  // the UI never needs the plaintext (or ciphertext) to render the masked view.
  maskedKey: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    optional: true
  },
  published: {
    type: Boolean,
    optional: true
  },
  unpublished: {
    type: Boolean,
    optional: true
  },
  deleted: {
    type: Boolean,
    optional: true
  },
  externalId: {
    type: String,
    optional: true
  },
  lastUsedDate: {
    type: String,
    optional: true
  },
  scope: {
    type: [String],
    optional: true
  },
  userId: {
    type: String,
    optional: true
  },
  // Marks the one "create a key" intent this entry came from, so a replay
  // of that intent resolves to this entry instead of minting a second key.
  // Namespaced with the creating user's _id server-side, so a token supplied by
  // one user can never address another user's marker.
  requestId: {
    type: String,
    optional: true,
    max: 128
  }
});

const publicBoMEntrySchema = new SimpleSchema({
  created: {
    type: Date,
    optional: true
  },
  key: {
    type: String
  },
  project: {
    type: String
  },
  module: {
    type: String,
    optional: true
  },
  release: {
    type: String,
    optional: true
  },
  published: {
    type: Boolean,
    optional: true
  },
  unpublished: {
    type: Boolean,
    optional: true
  },
  requests: {
    type: [String],
    optional: true
  }
});

const publicNoticeEntrySchema = new SimpleSchema({
  created: {
    type: Date,
    optional: true
  },
  key: {
    type: String
  },
  noticeId: {
    type: String
  },
  published: {
    type: Boolean,
    optional: true
  },
  unpublished: {
    type: Boolean,
    optional: true
  },
  requests: {
    type: [String],
    optional: true
  }
});

const publicReleaseKeyEntrySchema = new SimpleSchema({
  created: {
    type: Date,
    optional: true
  },
  // Release and CSAF feed keys are stored like API keys: `key` encrypted, `keyHash`
  // to find a presented key, `maskedKey` to show, `id` to manage it by.
  id: {
    type: String,
    optional: true
  },
  keyHash: {
    type: String,
    optional: true
  },
  maskedKey: {
    type: String,
    optional: true
  },
  requestCount: {
    type: Number,
    optional: true
  },
  key: {
    type: String
  },
  releaseId: {
    type: String
  },
  published: {
    type: Boolean,
    optional: true
  },
  unpublished: {
    type: Boolean,
    optional: true
  },
  requests: {
    type: [String],
    optional: true
  },
  scope: {
    type: [String],
    optional: true
  }
});

const publicCsafKeyEntrySchema = new SimpleSchema({
  created: {
    type: Date,
    optional: true
  },
  // Release and CSAF feed keys are stored like API keys: `key` encrypted, `keyHash`
  // to find a presented key, `maskedKey` to show, `id` to manage it by.
  id: {
    type: String,
    optional: true
  },
  keyHash: {
    type: String,
    optional: true
  },
  maskedKey: {
    type: String,
    optional: true
  },
  requestCount: {
    type: Number,
    optional: true
  },
  key: {
    type: String
  },
  name: {
    type: String,
    optional: true
  },
  tlpLevels: {
    type: [String],
    allowedValues: ['WHITE', 'GREEN', 'AMBER', 'RED']
  },
  // Allowed operations the key grants on the CSAF feed. Read-only ('view') for now;
  // write methods (create/edit/remove) will be added when those endpoints exist.
  operations: {
    type: [String],
    allowedValues: ['view', 'create', 'edit', 'remove'],
    optional: true
  },
  published: {
    type: Boolean,
    optional: true
  },
  requests: {
    type: [String],
    optional: true
  }
});

const privateLicensesSchema = new SimpleSchema({
  key: {
    type: String
  },
  description: {
    type: String,
    optional: true
  },
  author: {
    type: String
  },
  created: {
    type: Date,
    optional: true
  }
});

const privateAlgorithmsSchema = new SimpleSchema({
  key: {
    type: String
  },
  strength: {
    type: Number,
    optional: true
  },
  author: {
    type: String
  },
  created: {
    type: Date,
    optional: true
  }
});

const blacklistedAlgorithmsSchema = new SimpleSchema({
  key: {
    type: String
  },
  strength: {
    type: Number,
    optional: true
  },
  comment: {
    type: String,
    optional: true
  },
  createdBy: {
    type: String,
    optional: true
  },
  created: {
    type: Date,
    optional: true
  }
});

const CompanyStatistics = new SimpleSchema({
  date: {
    type: Date
  },
  modules: {
    type: CompanyStatisticsEntry
  },
  components: {
    type: CompanyStatisticsEntry
  },
  licenses: {
    type: CompanyStatisticsEntry
  }
});

const CompanyLeanixSettings = new SimpleSchema({
  companyName: {
    type: String
  },
  token: {
    type: String
  }
});

const CompanyJiraSettings = new SimpleSchema({
  url: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Url
  },
  user: {
    type: String,
    optional: true
  },
  passwd: {
    type: String,
    optional: true
  },
  key: {
    type: String,
    optional: true
  },
  type: {
    type: String,
    optional: true
  },
  email: {
    type: String,
    optional: true
  },
  active: {
    type: Boolean
  }
});

const CompanyTfsSettings = new SimpleSchema({
  account: {
    type: String
  },
  project: {
    type: String
  },
  token: {
    type: String
  },
  active: {
    type: Boolean
  }
});

const CompanyGithubSettings = new SimpleSchema({
  token: {
    type: String
  },
  repository: {
    type: String
  },
  active: {
    type: Boolean
  }
});

const CompanyScanossSettings = new SimpleSchema({
  token: {
    type: String
  },
  active: {
    type: Boolean
  }
});

const CompanyLicenseConfig = new SimpleSchema({
  whitelist: {
    type: [BWLicenseEntrySchema]
  },
  blacklist: {
    type: [BWLicenseEntrySchema]
  }
});

const CompanyCveConfig = new SimpleSchema({
  whitelist: {
    type: [BWCveEntrySchema]
  },
  blacklist: {
    type: [BWCveEntrySchema]
  }
});

const CompanyComponentConfig = new SimpleSchema({
  whitelist: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  blacklist: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  unchanged: {
    type: [BWComponentEntrySchema],
    optional: true
  },
  looseCoupled: {
    type: [BWComponentEntrySchema],
    optional: true
  }
});

const CompanyFossSettings = new SimpleSchema({
  company: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    optional: true
  },
  email: {
    type: String,
    optional: true
  },
  phone: {
    type: String,
    optional: true
  },
  zip: {
    type: String,
    optional: true
  },
  address: {
    type: String,
    optional: true
  },
  country: {
    type: String,
    optional: true
  },
  url: {
    type: String,
    optional: true
  },
  confirmed: {
    type: Date,
    optional: true
  },
  managed: {
    type: Date,
    optional: true
  }
});

const CompanyDistributionSettings = new SimpleSchema({
  email: {
    type: String,
    optional: true
  }
});

export const CompanyWrittenOfferSettings = new SimpleSchema({
  title: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  }
});

export const CompanySchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  enterprise: {
    type: String,
    optional: true
  },
  providerId: {
    type: String,
    optional: true
  },
  // CVD (ts-psirt) was removed; kept only because existing company documents still carry this field.
  tenantId: {
    type: String,
    optional: true
  },
  csafPrefixSecurityAdvisory: {
    type: String,
    optional: true
  },
  csafPrefixVex: {
    type: String,
    optional: true
  },
  csafPrefixInformationalAdvisory: {
    type: String,
    optional: true
  },
  csafPrefixSecurityIncident: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    // eslint-disable-next-line sonarjs/regex-complexity
    regEx: [/^[^<>]*$/, /^(?!.*<\/?\s*script\b)(?!.*javascript\s*:)(?!.*on\w+\s*=)[^<>`]*$/],
    optional: true
  },
  currencyCode: {
    type: String,
    optional: true
  },
  email: {
    type: String,
    regEx: SimpleSchema.RegEx.Email,
    optional: true
  },
  foss: {
    type: CompanyFossSettings,
    optional: true
  },
  psirt: {
    type: ProductContactsSchema,
    optional: true
  },
  distribution: {
    type: CompanyDistributionSettings,
    optional: true
  },
  leanix: {
    type: CompanyLeanixSettings,
    optional: true
  },
  jira: {
    type: CompanyJiraSettings,
    optional: true
  },
  tfs: {
    type: CompanyTfsSettings,
    optional: true
  },
  github: {
    type: CompanyGithubSettings,
    optional: true
  },
  scanoss: {
    type: CompanyScanossSettings,
    optional: true
  },
  apiKeys: {
    type: [apiKeyEntrySchema],
    optional: true
  },
  // publicBoMKeys / publicNoticeKeys: the deprecated public-BoM and public-Notice
  // keys. Nothing reads or writes them any more; they stay so existing company
  // documents still validate. Release keys replace them.
  publicBoMKeys: {
    type: [publicBoMEntrySchema],
    optional: true
  },
  publicNoticeKeys: {
    type: [publicNoticeEntrySchema],
    optional: true
  },
  publicReleaseKeys: {
    type: [publicReleaseKeyEntrySchema],
    optional: true
  },
  publicCsafKeys: {
    type: [publicCsafKeyEntrySchema],
    optional: true
  },
  statistics: {
    type: [CompanyStatistics],
    optional: true
  },
  created: {
    type: Date
  },
  licenseConfig: {
    type: CompanyLicenseConfig,
    optional: true
  },
  componentConfig: {
    type: CompanyComponentConfig,
    optional: true
  },
  cveConfig: {
    type: CompanyCveConfig,
    optional: true
  },
  requireWhitelist: {
    label:'Require allow',
    type: Boolean,
    optional: true
  },
  privateLicenses: {
    type: [privateLicensesSchema],
    optional: true
  },
  defaultRootComponentLicense: {
    type: String,
    optional: true
  },
  privateAlgorithms: {
    type: [privateAlgorithmsSchema],
    optional: true
  },
  blacklistedAlgorithms: {
    type: [blacklistedAlgorithmsSchema],
    optional: true
  },
  writtenOffer: {
    type: CompanyWrittenOfferSettings,
    optional: true
  },
  algorithmsConfig: {
    type: [AlgorithmsConfig],
    optional: true
  },
  endoflifePolicy: {
    type: EndoflifePolicy,
    optional: true
  }
});

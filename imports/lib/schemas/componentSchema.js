/* eslint-disable no-useless-escape */
import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {CommercialTermsSchema} from './commercialTermsSchema';

/* eslint-disable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */
const gitIncludedUrlRegEx = /^(?:(?:https?|ftp|ssh|git|svn):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/i;
/* eslint-enable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */

export const ComponentLicenseSchema = new SimpleSchema({
  key: {
    type: String,
    optional: true
  },
  name: {
    type: String
  },
  url: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  qos: {
    type: Number,
    min: 0,
    max: 4,
    optional: true
  }
});

export const ComponentCryptoAlgorithmSchema = new SimpleSchema({
  algorithm: {
    type: String,
    optional: true
  },
  strength: {
    type: String,
    optional: true
  }
});

// AI artifact marker attached to a component that bundles/uses a machine-learning-model.
// Mirrors ComponentCryptoAlgorithmSchema - a light marker on the component lake; the full
// CycloneDX modelCard is preserved verbatim (blackbox passthrough) and the managed,
// editable detail lives in the aiProperties collection.
export const ComponentAiModelSchema = new SimpleSchema({
  name: {
    type: String,
    optional: true
  },
  type: {
    type: String,
    optional: true
  },
  version: {
    type: String,
    optional: true
  },
  purl: {
    type: String,
    optional: true
  },
  provider: {
    type: String,
    optional: true
  },
  task: {
    type: String,
    optional: true
  },
  modelCard: {
    type: Object,
    blackbox: true,
    optional: true
  }
});

// Deep scan was removed; kept only because existing documents still carry this field.
export const  ComponentDeepScanSchema = new SimpleSchema({
  executed: {
    type: Date,
    optional: true
  },
  resultId: {
    type: String,
    optional: true
  },
  url: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  userName: {
    type: String,
    optional: true
  }
});

const ComponentChecksumSchema = new SimpleSchema({
  checksum: {
    type: String,
    regEx: /^[a-z0-9\-]{1,10}:[a-zA-Z0-9]+$/
  },
  qos: {
    type: Number,
    min: 0,
    max: 4,
    optional: true
  }
});

const ComponentVersionSchema = new SimpleSchema({
  version: {
    type: String,
    min: 1
  },
  toBeResearched: {
    type: Boolean,
    optional: true
  },
  releaseDate: {
    type: Date,
    optional: true
  },
  checksums: {
    type: [ComponentChecksumSchema],
    optional: true
  },
  licenses: {
    type: [ComponentLicenseSchema],
    optional: true
  },
  copyright: {
    type: String,
    optional: true
  },
  authors: {
    type: String,
    optional: true
  },
  commit: {
    type: String,
    optional: true
  },
  purl: {
    type: String,
    optional: true
  }
});

const ComponentLogSchema = new SimpleSchema({
  date: {
    type: Date
  },
  who: {
    type: String,
    min: 1
  },
  version: {
    type: String,
    min: 1,
    optional: true
  },
  text: {
    type: String,
    min: 1
  }
});

export const  ComponentUrlsSchema = new SimpleSchema({
  homepage: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  repository: {
    type: String,
    regEx: gitIncludedUrlRegEx,
    optional: true
  },
  issues: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  blog: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  docu: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  mailing: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  },
  notes: {
    type: String,
    regEx: SimpleSchema.RegEx.Url,
    optional: true
  }
});


const ComponentCrawlerSchema = new SimpleSchema({
  lastVisit: {
    type: Date
  },
  status: {
    type: Number
  },
  etag: {
    type: String,
    optional: true
  },
  info: {
    type: Object,
    blackbox: true
  }
});

const ComponentCPESchema = new SimpleSchema({
  name: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    optional: true
  },
  created: {
    type: Date,
    optional: true
  },
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  userName: {
    type: String,
    optional: true
  }
});

export const ComponentSchema = new SimpleSchema({
  _id: {
    type: SimpleSchema.RegEx.Id,
    optional: true
  },
  removed: {
    type: Boolean,
    optional: true
  },
  toBeResearched: {
    type: Boolean,
    optional: true
  },
  key: {
    type: String,
    regEx: /^[a-z]{1,5}:[a-zA-Z0-9-_\.:]+$/
  },
  oldKey: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    min: 1
  },
  purl: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  },
  shortDescription: {
    type: String,
    optional: true
  },
  product: {
    type: String,
    optional: true
  },
  edition: {
    type: String,
    optional: true
  },
  provider: {
    type: String,
    optional: true
  },
  providerUrl: {
    type: String,
    optional: true
  },
  providerAddress: {
    type: String,
    optional: true
  },
  licenseModel: {
    type: String,
    optional: true,
    allowedValues: ['SEAT_BASED', 'INSTALL_BASED', 'FLAT', 'OTHER']
  },
  comment: {
    type: String,
    optional: true
  },
  requirements_sw: {
    type: String,
    optional: true
  },
  requirements_hw: {
    type: String,
    optional: true
  },
  language: {
    type: String,
    optional: true,
    allowedValues: ['C', 'C#', 'C/C++', 'Go', 'HTML', 'Java', 'Javascript', 'Kotlin',
      'Objective-C', 'PHP', 'Python', 'R', 'Ruby', 'Scala', 'Shell', 'Swift', 'Typescript']
  },
  created: {
    type: Date,
    optional: true
  },
  createdBy: {
    type: String,
    optional: true
  },
  crypto_algorithms: {
    type: [ComponentCryptoAlgorithmSchema],
    optional: true
  },
  ai_models: {
    type: [ComponentAiModelSchema],
    optional: true
  },
  category: {
    type: [String],
    optional: true
  },
  updated: {
    type: Date,
    optional: true
  },
  updatedBy: {
    type: String,
    min: 1,
    optional: true
  },
  urls: {
    type: ComponentUrlsSchema
  },
  versions: {
    type: [ComponentVersionSchema],
    minCount: 1
  },
  logs: {
    type: [ComponentLogSchema],
    optional: true
  },
  // OpenSSF Scorecard was removed; kept only because existing component documents still carry this field.
  'crawlerInfo.ossf': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.pypi': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.github': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.mavencentral-releases': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.nist': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.npm-releases': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.nuget-releases': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  'crawlerInfo.mavens2-versions': {
    type: ComponentCrawlerSchema,
    optional: true
  },
  cpe: {
    type: [ComponentCPESchema],
    optional: true
  },
  declaredLicenses: {
    type: [ComponentLicenseSchema],
    optional: true
  },
  effectiveLicenses: {
    type: [ComponentLicenseSchema],
    optional: true
  },
  concludedLicenses: {
    type: [ComponentLicenseSchema],
    optional: true
  },
  declaredCopyright: {
    type: String,
    optional: true
  },
  // Deep scan was removed; kept only because existing documents still carry this field.
  deepScans: {
    type: [ComponentDeepScanSchema],
    optional: true
  },
  commercialTerms: {
    type: CommercialTermsSchema,
    optional: true
  }
});

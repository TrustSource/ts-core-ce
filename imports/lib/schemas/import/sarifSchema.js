import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SarifTestRun = new SimpleSchema({
  tool: {
    type: Object,
    blackbox: true
  },
  invocations: {
    type: Array,
    optional: true
  },
  'invocations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  conversion: {
    type: Object,
    optional: true,
    blackbox: true
  },
  language: {
    type: String,
    optional: true
  },
  versionControlProvenance: {
    type: Array,
    optional: true
  },
  'versionControlProvenance.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  originalUriBaseIds: {
    type: Object,
    optional: true,
    blackbox: true
  },
  artifacts: {
    type: Array,
    optional: true
  },
  'artifacts.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  logicalLocations: {
    type: Array,
    optional: true
  },
  'logicalLocations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  graphs: {
    type: Array,
    optional: true
  },
  'graphs.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  results: {
    type: Array,
    optional: true
  },
  'results.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  automationDetails: {
    type: Object,
    optional: true,
    blackbox: true
  },
  runAggregates: {
    type: Array,
    optional: true
  },
  'runAggregates.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  baselineGuid: {
    type: String,
    optional: true
  },
  redactionTokens: {
    type: [String],
    optional: true
  },
  defaultEncoding: {
    type: String,
    optional: true
  },
  defaultSourceLanguage: {
    type: String,
    optional: true
  },
  newlineSequences: {
    type: [String],
    optional: true
  },
  columnKind: {
    type: String,
    optional: true
  },
  externalPropertyFileReferences: {
    type: Array,
    optional: true
  },
  'externalPropertyFileReferences.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  threadFlowLocations: {
    type: Array,
    optional: true
  },
  'threadFlowLocations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  taxonomies: {
    type: Array,
    optional: true
  },
  'taxonomies.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  addresses: {
    type: Array,
    optional: true
  },
  'addresses.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  translations: {
    type: Array,
    optional: true
  },
  'translations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  policies: {
    type: Array,
    optional: true
  },
  'policies.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  webRequests: {
    type: Array,
    optional: true
  },
  'webRequests.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  webResponses: {
    type: Array,
    optional: true
  },
  'webResponses.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  specialLocations: {
    type: Array,
    optional: true
  },
  'specialLocations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  properties: {
    type: Object,
    optional: true,
    blackbox: true
  }
});


export const SarifSchema = new SimpleSchema({
  version: {
    type: String
  },
  runs: {
    type: [SarifTestRun]
  },
  inlineExternalProperties: {
    type: Array,
    optional: true
  },
  'inlineExternalProperties.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  properties: {
    type: Object,
    optional: true,
    blackbox: true
  }
});

import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SPDXJsonSchema = new SimpleSchema({
  SPDXID: {
    type: String
  },
  name: {
    type: String
  },
  spdxVersion: {
    type: String
  },
  creationInfo: {
    type: Object,
    blackbox: true
  },
  dataLicense: {
    type: String
  },
  comment: {
    type: String,
    optional: true
  },
  hasExtractedLicensingInfos: {
    type: Array,
    optional: true
  },
  'hasExtractedLicensingInfos.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  externalDocumentRefs: {
    type: Array,
    optional: true
  },
  'externalDocumentRefs.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  annotations: {
    type: Array,
    optional: true
  },
  'annotations.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  documentDescribes: {
    type: Array,
    optional: true
  },
  'documentDescribes.$': {
    type: String,
    optional: true
  },
  documentNamespace: {
    type: String
  },
  packages: {
    type: Array,
    optional: true
  },
  'packages.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  files: {
    type: Array,
    optional: true
  },
  'files.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  snippets: {
    type: Array,
    optional: true
  },
  'snippets.$': {
    type: Object,
    optional: true,
    blackbox: true
  },
  relationships: {
    type: Array,
    optional: true
  },
  'relationships.$': {
    type: Object,
    optional: true,
    blackbox: true
  }
});

export const SPDXSchema = new SimpleSchema({
  Name: {
    type: String
  },
  DocumentNamespace: {
    type: String,
    optional: true
  },
  CreationInfo: {
    type: Object,
    blackbox: true
  },
  Package: {
    type: Object,
    blackbox: true
  }
});

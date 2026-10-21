import {SimpleSchema} from 'meteor/aldeed:simple-schema';

/* eslint-disable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */
const gitIncludedUrlRegEx = /^(?:(?:https?|ftp|ssh|git|svn):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]+-?)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/i;
/* eslint-enable max-len, sonarjs/regex-complexity, sonarjs/slow-regex */

const ComponentUrlsSchema = new SimpleSchema({
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
  }
});

export const ComponentModificationSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  updated: {
    type: Date,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    denyUpdate: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  projectId: {
    type: String,
    optional: true
  },
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  userName: {
    type: String,
    optional: true
  },
  private: {
    type: Boolean,
    optional: true
  },
  urls: {
    type: ComponentUrlsSchema,
    optional: true
  },
  component: {
    type: Object
  },
  'component.key': {
    type: String
  },
  'component.version': {
    type: String,
    optional: true
  },
  'component.paths': {
    type: [String],
    optional: true
  },
  type: {
    type: String
  },
  value: {
    type: String
  }
});

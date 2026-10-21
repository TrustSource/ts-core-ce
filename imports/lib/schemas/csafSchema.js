import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const CSAFSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  submitted: {
    type: Date
  },
  failed: {
    type: Date,
    optional: true
  },
  failedReason: {
    type: String,
    optional: true
  },
  updated: {
    type: Date,
    optional: true
  },
  updatedBy: {
    type: String,
    optional: true
  },
  updatedByName: {
    type: String,
    optional: true
  },
  published: {
    type: Date,
    optional: true
  },
  publishedFileName: {
    type: String,
    optional: true
  },
  publishedBy: {
    type: String,
    optional: true
  },
  publishedByName: {
    type: String,
    optional: true
  },
  removed: {
    type: Date,
    optional: true
  },
  removedReason: {
    type: String,
    optional: true
  },
  removedBy: {
    type: String,
    optional: true
  },
  removedByName: {
    type: String,
    optional: true
  },
  companyId: {
    type: String
  },
  providerId: {
    type: String
  },
  status: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    optional: true
  },
  category: {
    type: String,
    optional: true
  },
  data: {
    type: String,
    optional: true,
    blackbox: true
  },
  tlp: {
    type: String,
    allowedValues: ['WHITE', 'GREEN', 'AMBER', 'RED'],
    optional: true
  }
});

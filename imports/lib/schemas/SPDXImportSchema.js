import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SPDXImportSchema = new SimpleSchema({
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  projectId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  originalId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  rdfFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  scanId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  status: {
    type: String,
    optional: true
  },
  created: {
    type: Date
  },
  updated: {
    type: Date
  }
});

import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SPDXExportSchema = new SimpleSchema({
  uuid: {
    type: String
  },
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  moduleId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  rdfFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  txtFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  xlsFileId: {
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

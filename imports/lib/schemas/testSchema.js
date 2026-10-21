import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const TestSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  type: {
    type: String
  },
  submitted: {
    type: Date
  },
  companyId: {
    type: String
  },
  demo: {
    type: Boolean,
    optional: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  scanId: {
    type: String,
    optional: true
  },
  analysisId: {
    type: String,
    optional: true
  },
  projectName: {
    type: String,
    optional: true
  },
  moduleName: {
    type: String,
    optional: true
  },
  status: {
    type: String,
    optional: true
  },
  tool: {
    type: String,
    optional: true
  },
  data: {
    type: String,
    optional: true,
    blackbox: true
  },
  rules: {
    type: Object,
    optional: true,
    blackbox: true
  }
});

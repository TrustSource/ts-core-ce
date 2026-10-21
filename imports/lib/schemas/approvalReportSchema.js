import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const ApprovalReportSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  approveId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true,
    denyUpdate: true
  },
  type: {
    type: String
  },
  data: {
    type: Object,
    blackbox: true,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SignatureSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  type: {
    type: String,
    optional: false
  },
  signature: {
    type: Object,
    optional: true,
    blackbox: true
  }
});

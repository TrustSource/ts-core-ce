import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const ComponentLogSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  createdBy: {
    type: String
  },
  componentKey: {
    type: String
  },
  componentId: {
    type: String
  },
  companyId: {
    type: String,
    optional: true,
    denyUpdate: true
  },
  version: {
    type: String,
    optional: true
  },
  text: {
    type: String
  }
});

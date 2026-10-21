import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const TagSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  deleted: {
    type: Date,
    optional: true
  },
  edited: {
    type: Date,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    denyUpdate: true
  },
  userId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id
  },
  userName: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    regEx: /^[a-z0-9:-]+$/,
    min: 2,
    max: 50
  },
  description: {
    type: String,
    optional: true
  }
});

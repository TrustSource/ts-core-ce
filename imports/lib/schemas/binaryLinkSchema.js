import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const BinaryLinkSchema = new SimpleSchema({
  name: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    optional: true
  },
  created: {
    type: Date,
    optional: true
  },
  userId: {
    type: String,
    optional: true
  },
  userName: {
    type: String,
    optional: true
  },
  locked: {
    type: Boolean,
    optional: true
  }
});


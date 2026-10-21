import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const TestToolSchema = new SimpleSchema({
  _id: {
    type: String,
    optional: true
  },
  name: {
    type: String,
    optional: true
  },
  website: {
    type: String,
    optional: true
  },
  logoLink: {
    type: String,
    optional: true
  },
  logoSmallLink: {
    type: String,
    optional: true
  },
  allowThreshold: {
    type: Boolean,
    optional: true
  },
  displayDefinitions: {
    type: String,
    optional: true,
    autoform: {
      rows: 5
    }
  },
  importMappings: {
    type: String,
    optional: true,
    autoform: {
      rows: 5
    }
  }
});

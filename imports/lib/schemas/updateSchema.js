import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const UpdateItemSchema = new SimpleSchema({
  description: {
    type: String,
    autoform: {
      rows: 5
    }
  },
  link: {
    type: String,
    optional: true
  }
});


export const UpdateSchema = new SimpleSchema({
  _id: {
    type: String,
    optional: true
  },
  version: {
    type: String,
    optional: true
  },
  installationId: {
    type: String,
    optional: true
  },
  created: {
    type: Date,
    autoform: {
      type: 'datetime-local'
    }
  },
  published: {
    type: Date,
    optional: true,
    autoform: {
      type: 'datetime-local'
    }
  },
  listNew: {
    type: [UpdateItemSchema],
    optional: true
  },
  listImprovement: {
    type: [UpdateItemSchema],
    optional: true
  },
  listFix: {
    type: [UpdateItemSchema],
    optional: true
  },
  viewedBy: {
    type: [String],
    optional: true
  }
});

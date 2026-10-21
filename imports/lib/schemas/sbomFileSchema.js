import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const SbomFileSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  edited: {
    type: Date,
    optional: true
  },
  version: {
    type: String,
    optional: true
  },
  companyId: {
    type: String,
    optional: true,
    denyUpdate: true
  },
  projectId: {
    type: String,
    optional: true
  },
  moduleId: {
    type: String,
    optional: true
  },
  analysisId: {
    type: String,
    optional: true
  },
  userId: {
    type: String
  },
  userName: {
    type: String,
    optional: true
  },
  components: {
    type: Number,
    min: 0,
    optional: true
  },
  completed: {
    type: Number,
    min: 0,
    optional: true
  },
  totalActivity: {
    type: Number,
    min: 0,
    optional: true
  },
  completedActivity: {
    type: Number,
    min: 0,
    optional: true
  },
  disabled: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  },
  release: {
    type: String,
    optional: true
  },
  approveId: {
    type: String,
    optional: true
  },
  list: {
    type: Array,
    optional: true
  },
  'list.$': {
    type: Object,
    optional: true
  },
  tree: {
    type: Object,
    optional: true
  },
  cryptoProperties: {
    type: Object,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

import {SimpleSchema} from 'meteor/aldeed:simple-schema';

// The task states the Tasks tab groups by; '' is "not set".
export const TASK_STATUS_VALUES = ['', 'backlog', 'planned', 'in_progress', 'in_review', 'completed'];

export const TaskSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
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
  companyId: {
    type: String
  },
  riskId: {
    type: String,
    optional: true
  },
  task: {
    type: String
  },
  due: {
    type: Date,
    optional: true
  },
  frequency: {
    type: String,
    optional: true
  },
  status: {
    type: String,
    optional: true,
    allowedValues: TASK_STATUS_VALUES
  },
  comment: {
    type: String,
    optional: true
  },
  githubLink: {
    type: String,
    optional: true
  },
  countermeasure: {
    type: String,
    optional: true
  },
  responsible: {
    type: [String],
    optional: true
  }
});

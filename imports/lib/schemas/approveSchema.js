import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {BinaryLinkSchema} from './binaryLinkSchema';

export const ApproveSchema = new SimpleSchema({
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
  approved: {
    type: Date,
    optional: true
  },
  rejected: {
    type: Date,
    optional: true
  },
  rejectedReason: {
    type: String,
    optional: true
  },
  purl: {
    type: String,
    optional: true
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true,
    denyUpdate: true
  },
  projectId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  moduleId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
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
  initiator: {
    type: String
  },
  initiatorName: {
    type: String
  },
  assignment: {
    type: String,
    optional: true
  },
  assignmentName: {
    type: String,
    optional: true
  },
  closedBy: {
    type: String,
    optional: true
  },
  closedByName: {
    type: String,
    optional: true
  },
  noticeFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  sbomId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  sbomFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  // SOUP reports were removed; kept only because existing approve documents still carry this field.
  soupFileId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  name: {
    type: String
  },
  version: {
    type: String,
    optional: true
  },
  description: {
    type: String,
    optional: true
  },
  comment: {
    type: String,
    optional: true
  },
  modules: {
    type: Array,
    optional: true
  },
  'modules.$': {
    type: Object,
    optional: true
  },
  'modules.$._id': {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  'modules.$.analysisId': {
    type: String,
    optional: true
  },
  'modules.$.scanId': {
    type: String,
    optional: true
  },
  'modules.$.tag': {
    type: String,
    optional: true
  },
  'modules.$.branch': {
    type: String,
    optional: true
  },
  'modules.$.release': {
    type: String,
    optional: true
  },
  'modules.$.date': {
    type: Date,
    optional: true
  },
  'modules.$.version': {
    type: String,
    optional: true
  },
  processed: {
    type: Boolean,
    optional: true
  },
  draft: {
    type: Boolean,
    optional: true
  },
  binaryLinks: {
    type: [BinaryLinkSchema],
    optional: true
  },
  stats: {
    type: Object,
    blackbox: true,
    optional: true
  },
  // Two-phase approve generation progress. Blackbox + optional (mirrors
  // `stats`) so the background per-stage $set updates (e.g. generation.stages.notice)
  // do not trip collection2 dotted-key validation. Streamed to the client by the
  // existing approveDetail publication (no field projection).
  generation: {
    type: Object,
    blackbox: true,
    optional: true
  },
  requests: {
    type: [String],
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

import {SimpleSchema} from 'meteor/aldeed:simple-schema';
import {CompanyWrittenOfferSettings} from '/imports/lib/schemas/companySchema';
import {BinaryLinkSchema} from './binaryLinkSchema';

export const NoticeFileSchema = new SimpleSchema({
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
  analysisId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
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
  obligations: {
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
  writtenOffer: {
    type: CompanyWrittenOfferSettings,
    optional: true
  },
  licenses: {
    type: Array,
    optional: true
  },
  'licenses.$': {
    type: Object,
    optional: true
  },
  unknownLicenseComponents: {
    type: Array,
    optional: true
  },
  'unknownLicenseComponents.$': {
    type: Object,
    optional: true
  },
  binaryLinks: {
    type: [BinaryLinkSchema],
    optional: true
  },
  fileUrl: {
    type: String,
    optional: true
  },
  demo: {
    type: Boolean,
    optional: true
  }
});

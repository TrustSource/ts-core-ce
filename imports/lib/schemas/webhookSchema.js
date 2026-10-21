import {SimpleSchema} from 'meteor/aldeed:simple-schema';

export const WebhookSchema = new SimpleSchema({
  _id: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
  },
  created: {
    type: Date
  },
  companyId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    denyUpdate: true
  },
  projectId: {
    type: String,
    regEx: SimpleSchema.RegEx.Id,
    optional: true
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
    type: String
  },
  triggers: {
    type: Array
  },
  'triggers.$': {
    type: String
  },
  type: {
    type: String
  },
  method: {
    type: String,
    optional: true
  },
  // Stored encrypted (v2:...); urlDisplay is the masked form the pages show.
  url: {
    type: String,
    optional: true
  },
  urlDisplay: {
    type: String,
    optional: true
  },
  // Signing secret for X-TrustSource-Signature, stored encrypted.
  secret: {
    type: String,
    optional: true
  },
  headers: {
    type: Array,
    optional: true
  },
  'headers.$': {
    type: Object
  },
  'headers.$.key': {
    type: String
  },
  'headers.$.value': {
    type: String
  }
});

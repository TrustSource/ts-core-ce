import {Meteor} from 'meteor/meteor';
import {SimpleSchema} from 'meteor/aldeed:simple-schema';

// A license in the catalog is metadata only. The Community Edition carries no legal
// assessment of licenses, so no constraints or assessment state belong here.
export const LicenseSchema = new SimpleSchema({
  _id: {
    type: Meteor.Collection.ObjectID,
    optional: true
  },
  key: {
    type: String,
    min: 1
  },
  name: {
    type: String,
    min: 1
  },
  url: {
    type: String,
    optional: true,
    regEx: SimpleSchema.RegEx.Url
  },
  created: {
    type: Date
  },
  updated: {
    type: Date,
    optional: true
  },
  text: {
    type: String,
    optional: true
  },
  aliases: {
    type: [String],
    optional: true,
    minCount: 0
  },
  copyright: {
    type: String,
    label: 'Copyright remark',
    optional: true
  }
});

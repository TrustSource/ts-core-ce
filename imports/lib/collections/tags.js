import {Mongo} from 'meteor/mongo';
import Tag from '/imports/lib/company/Tag';
import {TagSchema} from '/imports/lib/schemas/tagSchema';

const Tags = new Mongo.Collection('tags', {
  transform: function (doc) {
    return new Tag(doc);
  }
});

Tags.attachSchema(TagSchema);

export default Tags;


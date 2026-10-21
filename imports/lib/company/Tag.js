import _ from 'underscore';
import {TagSchema} from '/imports/lib/schemas/tagSchema';

const Tag = function (doc) {
  _.extend(this, doc);
};

Tag.prototype.validate = function () {
  const context = TagSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default Tag;

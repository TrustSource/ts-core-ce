import _ from 'underscore';
import {ComponentModificationSchema} from '/imports/lib/schemas/componentModificationSchema';

const ComponentModification = function (doc) {
  _.extend(this, doc);
};

ComponentModification.prototype.validate = function () {
  const context = ComponentModificationSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default ComponentModification;

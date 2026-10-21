import _ from 'underscore';
import {ComponentLogSchema} from '/imports/lib/schemas/componentLogSchema';

const ComponentLog = function (doc) {
  _.extend(this, doc);
};

ComponentLog.prototype.validate = function () {
  const context = ComponentLogSchema.newContext();
  context.validate(_.pick(this, _.keys(this)));
  return context;
};

export default ComponentLog;

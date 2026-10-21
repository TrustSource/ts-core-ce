import {Mongo} from 'meteor/mongo';
import ComponentLog from '/imports/lib/component/ComponentLog';
import {ComponentLogSchema} from '/imports/lib/schemas/componentLogSchema';

const ComponentLogs = new Mongo.Collection('componentLogs', {
  transform: function (doc) {
    return new ComponentLog(doc);
  }
});

ComponentLogs.attachSchema(ComponentLogSchema);

export default ComponentLogs;


import {Mongo} from 'meteor/mongo';
import ComponentModification from '/imports/lib/component/ComponentModification';
import {ComponentModificationSchema} from '/imports/lib/schemas/componentModificationSchema';

const ComponentModifications = new Mongo.Collection('componentModifications', {
  transform: function (doc) {
    return new ComponentModification(doc);
  }
});

ComponentModifications.attachSchema(ComponentModificationSchema);

export default ComponentModifications;


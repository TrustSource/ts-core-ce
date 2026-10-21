import {Mongo} from 'meteor/mongo';
import Approve from '/imports/lib/project/Approve';
import {ApproveSchema} from '/imports/lib/schemas/approveSchema';

const Approves = new Mongo.Collection('approves', {
  transform: function (doc) {
    return new Approve(doc);
  }
});

Approves.attachSchema(ApproveSchema);

export default Approves;

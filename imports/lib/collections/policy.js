import {Mongo} from 'meteor/mongo';
import PolicyItem from '/imports/lib/company/Policy';

const Policy = new Mongo.Collection('policy', {
  transform: function (doc) {
    return new PolicyItem(doc);
  }
});

export default Policy;


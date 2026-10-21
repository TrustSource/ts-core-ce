import {Mongo} from 'meteor/mongo';
import Company from '/imports/lib/company/Company';

const Companies = new Mongo.Collection('companies', {
  transform: function (doc) {
    return new Company(doc);
  }
});

export default Companies;


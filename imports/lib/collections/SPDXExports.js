import {Mongo} from 'meteor/mongo';
import SPDXExport from '/imports/lib/models/SPDXExport';

const SPDXExports = new Mongo.Collection('SPDXExports', {
  transform: function (doc) {
    return new SPDXExport(doc);
  }
});

export default SPDXExports;

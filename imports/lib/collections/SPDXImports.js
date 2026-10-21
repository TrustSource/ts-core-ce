import {Mongo} from 'meteor/mongo';
import SPDXImport from '/imports/lib/models/SPDXImport';

const SPDXImports = new Mongo.Collection('SPDXImports', {
  transform: function (doc) {
    return new SPDXImport(doc);
  }
});

export default SPDXImports;

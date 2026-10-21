import {Mongo} from 'meteor/mongo';
import SbomFile from '/imports/lib/company/SbomFile';

const SbomFiles = new Mongo.Collection('sbomFiles', {
  transform: function (doc) {
    return new SbomFile(doc);
  }
});

export default SbomFiles;

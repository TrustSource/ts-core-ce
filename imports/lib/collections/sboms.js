import {Mongo} from 'meteor/mongo';
import SBOM from '/imports/lib/project/Sbom';
import {SBOMSchema} from '/imports/lib/schemas/sbomSchema';

const SBOMs = new Mongo.Collection('sboms', {
  transform: function (doc) {
    return new SBOM(doc);
  }
});

SBOMs.attachSchema(SBOMSchema);

export default SBOMs;

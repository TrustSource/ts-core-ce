import {Mongo} from 'meteor/mongo';
import ManualVulnerability from '/imports/lib/company/ManualVulnerability';
import {ManualVulnerabilitySchema} from '/imports/lib/schemas/manualVulnerabilitySchema';

const ManualVulnerabilities = new Mongo.Collection('manualVulnerabilities', {
  transform: function (doc) {
    return new ManualVulnerability(doc);
  }
});

ManualVulnerabilities.attachSchema(ManualVulnerabilitySchema);

export default ManualVulnerabilities;


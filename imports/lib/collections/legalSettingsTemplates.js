import {Mongo} from 'meteor/mongo';
import LegalSettingsTemplate from '/imports/lib/project/LegalSettingsTemplate';
import {LegalSettingsTemplateSchema} from '/imports/lib/schemas/legalSettingsTemplateSchema';

const LegalSettingsTemplates = new Mongo.Collection('legalSettingsTemplates', {
  transform: function (doc) {
    return new LegalSettingsTemplate(doc);
  }
});

LegalSettingsTemplates.attachSchema(LegalSettingsTemplateSchema);

export default LegalSettingsTemplates;


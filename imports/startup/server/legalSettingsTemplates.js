import {Meteor} from 'meteor/meteor';
import {LegalSettingsTemplatesRemove} from '/imports/lib/interactors/legalSettingsTemplates'

Meteor.methods({
  'LegalSettingsTemplates.Remove': LegalSettingsTemplatesRemove
});

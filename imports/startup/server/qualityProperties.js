import {Meteor} from 'meteor/meteor';
import {QualityPropertiesCreate, QualityPropertiesRemove, QualityPropertiesUpdate,
  QualityPropertiesFind} from '/imports/lib/interactors/qualityProperties';

Meteor.methods({
  'QualityProperties.Create': async function (...args) { return await QualityPropertiesCreate.apply(this, args); },
  'QualityProperties.Update': async function (...args) { return await QualityPropertiesUpdate.apply(this, args); },
  'QualityProperties.Remove': async function (...args) { return await QualityPropertiesRemove.apply(this, args); },
  'QualityProperties.Find': async function (...args) { return await QualityPropertiesFind.apply(this, args); }
});

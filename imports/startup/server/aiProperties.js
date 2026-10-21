import {Meteor} from 'meteor/meteor';
import {AiPropertiesCreate, AiPropertiesRemove, AiPropertiesUpdate,
  AiPropertiesFind} from '/imports/lib/interactors/aiProperties';

Meteor.methods({
  'AiProperties.Create': async function (...args) { return await AiPropertiesCreate.apply(this, args); },
  'AiProperties.Update': async function (...args) { return await AiPropertiesUpdate.apply(this, args); },
  'AiProperties.Remove': async function (...args) { return await AiPropertiesRemove.apply(this, args); },
  'AiProperties.Find': async function (...args) { return await AiPropertiesFind.apply(this, args); }
});

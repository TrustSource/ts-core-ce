import {Meteor} from 'meteor/meteor';
import {CapabilitiesCreate, CapabilitiesRemove, CapabilitiesUpdate,
  CapabilitiesFind, CapabilitiesFindByProject} from '/imports/lib/interactors/capabilities';

Meteor.methods({
  'Capabilities.Create': async function (...args) { return await CapabilitiesCreate.apply(this, args); },
  'Capabilities.Update': async function (...args) { return await CapabilitiesUpdate.apply(this, args); },
  'Capabilities.Remove': async function (...args) { return await CapabilitiesRemove.apply(this, args); },
  'Capabilities.Find': async function (...args) { return await CapabilitiesFind.apply(this, args); },
  'Capabilities.FindByProject': async function (...args) { return await CapabilitiesFindByProject.apply(this, args); }
});

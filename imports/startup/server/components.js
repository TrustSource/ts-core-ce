import {Meteor} from 'meteor/meteor';
import {
  ComponentCreate, ComponentIdByKey, ComponentPublicCreate, ComponentPublicCreateVersion,
  ComponentSoftRemove,
  ComponentSoftRemoveUndo
} from '/imports/lib/interactors/components';

Meteor.methods({
  'Components.Create': async function (...args) { return await ComponentCreate.apply(this, args); },
  'Components.SoftRemove': async function (...args) { return await ComponentSoftRemove.apply(this, args); },
  'Components.SoftRemoveUndo': async function (...args) { return await ComponentSoftRemoveUndo.apply(this, args); },
  'Components.PublicCreate': async function (...args) { return await ComponentPublicCreate.apply(this, args); },
  'Components.PublicCreateVersion': async function (...args) { return await ComponentPublicCreateVersion.apply(this, args); },
  'Components.IdByKey': async function (...args) { return await ComponentIdByKey.apply(this, args); }
});

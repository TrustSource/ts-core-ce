import {Meteor} from 'meteor/meteor';
import {TagsCreate, TagsRemove, TagsReactivate, TagsImport, TagsCheckImport} from '/imports/lib/interactors/tags'

Meteor.methods({
  'Tags.Create': async function (...args) { return await TagsCreate.apply(this, args); },
  'Tags.Remove': async function (...args) { return await TagsRemove.apply(this, args); },
  'Tags.Reactivate': async function (...args) { return await TagsReactivate.apply(this, args); },
  'Tags.Import': async function (...args) { return await TagsImport.apply(this, args); },
  'Tags.CheckImport': async function (...args) { return await TagsCheckImport.apply(this, args); }
});

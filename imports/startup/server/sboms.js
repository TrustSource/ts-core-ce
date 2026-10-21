import {Meteor} from 'meteor/meteor';
import {SBOMsCreate} from '/imports/lib/interactors/sboms'

Meteor.methods({
  'SBOMs.Create': SBOMsCreate
});

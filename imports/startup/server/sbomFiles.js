import {Meteor} from 'meteor/meteor';
import {SbomFilesCreate, SbomFilesUpdate, SbomFilesFreeze,
  SbomFilesFindByAnalysis, SbomFilesRemove} from '/imports/lib/interactors/sbomFiles'

Meteor.methods({
  'SbomFiles.Create': SbomFilesCreate,
  'SbomFiles.Update': SbomFilesUpdate,
  'SbomFiles.Freeze': SbomFilesFreeze,
  'SbomFiles.FindByAnalysis': SbomFilesFindByAnalysis,
  'SbomFiles.Remove': SbomFilesRemove
});

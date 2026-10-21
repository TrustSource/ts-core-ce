import {Meteor} from 'meteor/meteor';
import {CweMappingsSet, CweMappingsRemove} from '/imports/lib/interactors/cweMappings';

// Manual CWE assignment. Both handlers resolve the company from the
// caller and check the role themselves - see set.js - so there is nothing to
// gate here. Not feature-licensed: reading a tool's own weakness ids is part of
// the SARIF import every company has, and so is saying what an unclassified rule
// actually is.
Meteor.methods({
  'CweMappings.Set': async function (...args) { return await CweMappingsSet.apply(this, args); },
  'CweMappings.Remove': async function (...args) { return await CweMappingsRemove.apply(this, args); }
});

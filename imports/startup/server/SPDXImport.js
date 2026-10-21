import {Meteor} from 'meteor/meteor';
import {SPDXImportsImport} from '/imports/lib/interactors/SPDXImports'

Meteor.methods({
  'SPDXImports.Import': SPDXImportsImport
});

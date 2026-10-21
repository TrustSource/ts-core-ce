import {Meteor} from 'meteor/meteor';
import {SPDXExportsCreate} from '/imports/lib/interactors/SPDXExports'

Meteor.methods({
  'SPDXExports.Create': SPDXExportsCreate
});

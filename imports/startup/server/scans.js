import {Meteor} from 'meteor/meteor';
import {ScansUpdate, ScansBinaryLinkAdd, ScansBinaryLinkRemove} from '/imports/lib/interactors/scans'

Meteor.methods({
  'Scans.Update': async function (...args) { return await ScansUpdate.apply(this, args); },
  'Scans.BinaryLinkAdd': async function (...args) { return await ScansBinaryLinkAdd.apply(this, args); },
  'Scans.BinaryLinkRemove': async function (...args) { return await ScansBinaryLinkRemove.apply(this, args); }
});
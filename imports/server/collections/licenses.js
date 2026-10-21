import {Meteor} from 'meteor/meteor';
import Utils from '/imports/server/ServerUtils';
import Licenses from '/imports/lib/collections/licenses';
import LicensesService from '/imports/api/licenses';
import {licenseProjection} from '/imports/lib/licenses/licenseFields';

export const RawLicenses = Utils.makeRawCollection(Licenses);

// Writes go through the Licenses.Create / Licenses.Update methods only
// (imports/startup/server/licenses.js). With no allow rule, a direct client write
// is denied.

Meteor.publish('licenses', async function (limited) {
  return Licenses.find({}, {fields: licenseProjection({withText: !limited})});
});

Meteor.publish('licenseDetail', async function (key) {
  if (typeof key !== 'string' || !key) { return this.ready(); }
  return Licenses.find({key: key}, {fields: licenseProjection({withText: true})});
});

Meteor.methods({
  getLicenseDetails: async function (licenseKey) {
    if (typeof licenseKey !== 'string') { return undefined; }
    return await Licenses.findOneAsync({key: licenseKey}, {fields: licenseProjection({withText: true})});
  },
  getLicenseByNameOrKeyOrAlias: async function (licenseQ) {
    return LicensesService.find(licenseQ)
  },
  countLicenseByNameOrKeyOrAlias: async function (licenseQ) {
    return LicensesService.count(licenseQ)
  }
});

/**
 * Create global raw Collection and ensure indexes
 */
Meteor.startup(function () {
  RawLicenses.createIndex('name');
  RawLicenses.createIndex('key', {unique: true});
  RawLicenses.createIndex({name: 'text'}, {name: 'TextIndex', weights: {name: 8}});
});

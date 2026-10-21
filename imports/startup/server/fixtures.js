
import {Meteor} from 'meteor/meteor';
import Licenses from '/imports/lib/collections/licenses';
import LicensesService from '/imports/api/licenses';
import {CATCH_ALL_LICENSE_SEEDS} from '/imports/lib/licenseResolution/catchAllLicenses';
import {licensesToSeed} from '/imports/lib/licenses/licenseSeed';
import {licenseTextsToBackfill} from '/imports/lib/licenses/licenseTextBackfill';
import POPULAR_LICENSES from '/imports/server/licenses/popular-licenses.json';
import InfrastructureComponents from '/imports/lib/collections/infrastructureComponents';
import {infrastructureComponentsToSeed} from '/imports/lib/component/infrastructureComponentSeed';
import POPULAR_INFRASTRUCTURE_COMPONENTS from '/imports/server/infrastructureComponents/popular-infrastructure-components.json';

/**
 * Licenses
 */
/**
 * Insert one catch-all catalogue entry when its key is missing.
 * An existing entry is never modified, so an edit made in the UI survives restarts.
 *
 * @param {Object} spec one entry of CATCH_ALL_LICENSE_SEEDS
 * @returns {Promise<String>} 'inserted' | 'unchanged'
 */
async function ensureCatalogueLicense(spec) {
  if (await Licenses.findOneAsync({key: spec.key}, {fields: {_id: 1}})) {
    return 'unchanged';
  }
  // Deep-copied: CATCH_ALL_LICENSE_SEEDS is a module-level constant shared with
  // the client-side picker, and the driver must not end up holding a reference into it.
  const seed = JSON.parse(JSON.stringify(spec));
  await Licenses.insertAsync(Object.assign(seed, {created: new Date()}));
  return 'inserted';
}

Meteor.startup(async () => {
  const seedOutcome = {inserted: 0, unchanged: 0};
  for (const spec of CATCH_ALL_LICENSE_SEEDS) {
    try {
      seedOutcome[await ensureCatalogueLicense(spec)] += 1;
    } catch (e) {
      console.error('=> Catch-all license seed failed for', spec.key, e.message);
    }
  }
  if (seedOutcome.inserted) {
    console.log('=> Catch-all licenses inserted:', seedOutcome.inserted);
  }

  // Popular licenses with their full texts. Seeded once: only keys still missing are
  // inserted, so a license edited in the UI is never overwritten, and a key added to
  // popular-licenses.json is picked up on the next start.
  const existingLicenses = await Licenses.find({}, {fields: {key: 1, text: 1}}).fetchAsync();
  const existingKeys = existingLicenses.map(function (license) { return license.key; });
  let seededCount = 0;
  for (const license of licensesToSeed(POPULAR_LICENSES.licenses, existingKeys)) {
    try {
      await Licenses.insertAsync(Object.assign({}, license, {created: new Date()}));
      seededCount++;
    } catch (e) {
      console.error('=> License seed failed for', license.key, e.message);
    }
  }
  if (seededCount) {
    console.log('=> Popular licenses seeded:', seededCount);
  }
  // A catalog that already carried a seed key never received its license text, because
  // the insert above is skipped on a taken key. Without the text a notice file cannot
  // print the license it attributes components under. Only a row with no text of its
  // own is filled - the selector repeats the condition so a text written between the
  // read and the write is never clobbered - and nothing but `text` is touched.
  let backfilledCount = 0;
  for (const fill of licenseTextsToBackfill(POPULAR_LICENSES.licenses, existingLicenses)) {
    try {
      backfilledCount += await Licenses.updateAsync(
        {_id: fill._id, $or: [{text: {$exists: false}}, {text: null}, {text: ''}]},
        {$set: {text: fill.text}}
      );
    } catch (e) {
      console.error('=> License text backfill failed for', fill.key, e.message);
    }
  }
  if (backfilledCount) {
    console.log('=> Popular license texts backfilled:', backfilledCount);
  }
  // LicensesService caches the whole catalogue at startup and matchLicense reads
  // that cache, so on a fresh database the entries just seeded would be invisible
  // to license matching - and to the picker - until the next restart.
  await LicensesService.init();
});

// Common infrastructure components, seeded the same way as the popular licenses: only
// keys still missing are inserted (a soft-removed component still counts as present), so
// a component edited or soft-removed in the UI is never brought back or overwritten.
Meteor.startup(async () => {
  const existingKeys = (await InfrastructureComponents.find({}, {fields: {key: 1}, transform: null}).fetchAsync())
    .map(function (component) { return component.key; });
  let seededCount = 0;
  for (const component of infrastructureComponentsToSeed(POPULAR_INFRASTRUCTURE_COMPONENTS.components, existingKeys)) {
    try {
      await InfrastructureComponents.insertAsync(Object.assign(component, {created: new Date(), createdBy: 'ts-app'}));
      seededCount++;
    } catch (e) {
      console.error('=> Infrastructure component seed failed for', component.key, e.message);
    }
  }
  if (seededCount) {
    console.log('=> Popular infrastructure components seeded:', seededCount);
  }
});

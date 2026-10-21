import {Meteor} from 'meteor/meteor';
import Updates from '/imports/lib/collections/updates';
import {httpGet} from '/imports/lib/httpFetch';
import {RELEASE_NOTES, releaseNotesToInsert, currentVersion, updateCheckSettings, newerVersion} from '/imports/server/updates/releaseNotes';

// Requests the update check URL with this installation's id to look for a newer
// version. Never throws, so a failed check only logs. TS_UPDATE_CHECK=false turns
// it off for installations that must not make outbound calls.
async function checkForNewVersion() {
  const settings = updateCheckSettings(process.env);
  if (!settings.enabled) {
    console.log('=> Version check disabled (TS_UPDATE_CHECK=false)');
    return;
  }
  try {
    const entry = await Updates.findOneAsync({installationId: {$exists: true}}, {fields: {installationId: 1}});
    const params = entry ? {installationId: entry.installationId} : undefined;
    const result = await httpGet(settings.url, {
      params, headers: {Accept: 'application/json'}, timeoutMs: 10000, maxBytes: 1024 * 1024
    });
    const newer = newerVersion(currentVersion(), result.data);
    console.log(newer ? `=> Version check: version ${newer} is available` : '=> Version check: up to date');
  // eslint-disable-next-line sonarjs/no-ignored-exceptions
  } catch (e) {
    console.log('=> Version check was unsuccessful');
  }
}

// Logs the current version, inserts the shipped release notes
// (imports/server/updates/releaseNotes.js) that are not in the database yet, then
// checks for a newer version. Existing entries are never changed.
Meteor.startup(async () => {
  console.log('=> Version:', currentVersion());
  try {
    const ids = RELEASE_NOTES.map((note) => note._id);
    const existing = await Updates.find({_id: {$in: ids}}, {fields: {_id: 1}}).fetchAsync();
    const docs = releaseNotesToInsert(existing.map((doc) => doc._id));
    for (const doc of docs) {
      await Updates.insertAsync(doc);
    }
    if (docs.length) {
      console.log('=> Release notes inserted:', docs.map((doc) => doc.version).join(', '));
    }
  } catch (e) {
    console.error('=> Release notes could not be inserted:', e && e.message);
  }
  // After the insert, so the installation id exists on the first run. Not awaited,
  // so a slow or unreachable host does not delay startup.
  checkForNewVersion();
});

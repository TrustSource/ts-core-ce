import Companies from '/imports/lib/collections/companies';
import Approves from '/imports/lib/collections/approves';
import {newPublicKeyEntry} from '/imports/server/security/publicKeys';

/**
 * The public release key of a release, created when it has none.
 *
 * Used by the approval flow. It needs no logged-in user, so an approval made
 * through the REST API gets its key too, and approving a release again returns its
 * existing key instead of adding another.
 *
 * @param {String} companyId  the company that owns the release
 * @param {String} releaseId  the approval
 * @param {Object} [options]  {published: true} publishes the key (the approval flow)
 * @returns {Promise<Object|null>} the key entry, or null when the release is not the company's
 */
export async function ensureReleaseKey(companyId, releaseId, options = {}) {
  if (typeof companyId !== 'string' || typeof releaseId !== 'string' ||
    !await Approves.findOneAsync({_id: releaseId, companyId}, {fields: {_id: 1}})) {
    return null;
  }
  const company = await Companies.findOneAsync(companyId, {fields: {publicReleaseKeys: 1}});
  const existing = ((company && company.publicReleaseKeys) || []).find(function (item) {
    return item.releaseId === releaseId;
  });
  if (existing) {
    if (options.published && (existing.published !== true || existing.unpublished)) {
      const match = existing.id ? {'publicReleaseKeys.id': existing.id} : {'publicReleaseKeys.key': existing.key};
      await Companies.updateAsync(Object.assign({_id: companyId}, match),
        {$set: {'publicReleaseKeys.$.published': true, 'publicReleaseKeys.$.unpublished': false}});
      return Object.assign({}, existing, {published: true, unpublished: false});
    }
    return existing;
  }
  return await pushReleaseKey(companyId, releaseId, options);
}

async function pushReleaseKey(companyId, releaseId, options) {
  // Stored encrypted, like every release key (security/publicKeys.js).
  const entry = newPublicKeyEntry({
    created: new Date(),
    releaseId: releaseId,
    requests: []
  });
  if (options.published) {
    entry.published = true;
    entry.unpublished = false;
  }
  await Companies.updateAsync(companyId, {$push: {publicReleaseKeys: entry}});
  return entry;
}

/**
 * A new release key, also when the release already has one (the release keys page
 * may hand out several keys for one release, e.g. with different scopes).
 *
 * @returns {Promise<Object|null>} the key entry, or null when the release is not the company's
 */
export async function createReleaseKey(companyId, releaseId, options = {}) {
  if (typeof companyId !== 'string' || typeof releaseId !== 'string' ||
    !await Approves.findOneAsync({_id: releaseId, companyId}, {fields: {_id: 1}})) {
    return null;
  }
  return await pushReleaseKey(companyId, releaseId, options);
}

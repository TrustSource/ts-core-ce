import CryptoProperties from '/imports/lib/collections/cryptoProperties';
import Utils from '/imports/lib/utils';

// Persists imported cryptographic-asset payloads with an explicit user/company
// (REST context has no Meteor.user()). Each item: {name, assetType, *Properties}.
//
// Imported assets are stored MODULE-scoped: `moduleId` is set and `projectId` is
// intentionally omitted. This matches the storage convention enforced by
// cryptoProperties/find.js (`CryptoProperties.Find`), which selects module-level
// entries with `{moduleId, projectId: {$exists: false}}`. Setting both ids would
// match neither the module- nor the project-level query, so the asset would be
// invisible in "Algorithms as managed" and absent from the CBOM export's
// findCryptoDetail lookup. `projectId` is accepted for signature parity but unused.
const persistImported = async function ({list, companyId, projectId, moduleId, user}) { // eslint-disable-line no-unused-vars
  if (!Array.isArray(list) || !list.length) return 0;
  const userName = user && ((user.profile && user.profile.name)
    || (user.emails && user.emails[0] && user.emails[0].address)
    || (user.profile && user.profile.email));
  let inserted = 0;
  for (const item of list) {
    if (!item || !item.name) continue;
    const doc = {
      created: new Date(),
      userId: user && user._id,
      userName,
      companyId,
      moduleId,
      name: item.name,
      origin: 'import',
      assetType: item.assetType || 'algorithm',
      algorithmProperties: Utils.cleanObject(item.algorithmProperties || {}),
      certificateProperties: Utils.cleanObject(item.certificateProperties || {}),
      protocolProperties: Utils.cleanObject(item.protocolProperties || {}),
      relatedCryptoMaterialProperties: Utils.cleanObject(item.relatedCryptoMaterialProperties || {})
    };
    await CryptoProperties.insertAsync(doc);
    inserted += 1;
  }
  return inserted;
};

export default persistImported;

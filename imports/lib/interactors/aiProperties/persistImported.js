import AiProperties from '/imports/lib/collections/aiProperties';

// Persists imported machine-learning-model payloads with an explicit user/company
// (REST/import context has no Meteor.user()). Each item: {name, type, version, purl,
// provider, task, modelCard}.
//
// Imported AI artifacts are stored MODULE-scoped: `moduleId` is set and `projectId` is
// intentionally omitted, matching the storage convention enforced by aiProperties/find.js
// (`AiProperties.Find`), which selects module-level entries with
// `{moduleId, projectId: {$exists: false}}`. This mirrors cryptoProperties/persistImported.
// `projectId` is accepted for signature parity but unused.
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
      type: item.type || 'machine-learning-model',
      version: item.version,
      purl: item.purl,
      provider: item.provider,
      task: item.task,
      modelFamily: item.modelFamily,
      architecture: item.architecture,
      modelCard: (item.modelCard && typeof item.modelCard === 'object') ? item.modelCard : undefined,
      // Full original CycloneDX component, kept so export round-trips losslessly.
      raw: (item.raw && typeof item.raw === 'object') ? item.raw : undefined
    };
    await AiProperties.insertAsync(doc);
    inserted += 1;
  }
  return inserted;
};

export default persistImported;

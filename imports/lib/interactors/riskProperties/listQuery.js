// Pure, dependency-free builder for the risk-list Mongo selector.
// CommonJS so the Jest harness can require it without Meteor.
//
// Risks are stored in three shapes:
//   (1) project-only  {projectId}
//   (2) module-only   {moduleId}
//   (3) both-fields   {projectId, moduleId}  (threat-model REST risks)
//
// Filter precedence: moduleId -> projectId -> none.
//
// `params`            : sanitized {companyId, moduleId?, projectId?, name?}
// `projectModuleIds`  : _ids of the project's modules (resolved by the caller).
// Returns a plain Mongo selector, or null when no filter is supplied.
function buildRiskListSelector(params, projectModuleIds) {
  const {companyId} = params;

  if (params.moduleId) {
    // A both-set {moduleId, projectId} call is INTENTIONALLY moduleId-scoped:
    // it falls into this branch first and matches shapes 2 & 3 for the module.
    // Do NOT convert this to an AND with projectId - that would drop shape-3
    // rows whose projectId differs from the (irrelevant) UI projectId param.
    const selector = {companyId, moduleId: params.moduleId};
    if (params.name) {
      selector.name = params.name;
    }
    return selector;
  }

  if (params.projectId) {
    // Single $or query (de-dup is inherent - no second query + concat):
    //  - project-only rows: {projectId, moduleId:$exists:false}  -> shape 1
    //  - any risk on one of the project's modules: {moduleId:$in} -> shapes 2 & 3
    const orClauses = [
      {projectId: params.projectId, moduleId: {$exists: false}}
    ];
    if (Array.isArray(projectModuleIds) && projectModuleIds.length > 0) {
      orClauses.push({moduleId: {$in: projectModuleIds}});
    }
    const selector = {companyId};
    if (params.name) {
      // top-level so it ANDs across every $or branch
      selector.name = params.name;
    }
    selector.$or = orClauses;
    return selector;
  }

  return null;
}

module.exports = {buildRiskListSelector};

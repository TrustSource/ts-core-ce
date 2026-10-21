import {Meteor} from 'meteor/meteor';
import Modules from '/imports/lib/collections/modules';
import RiskProperties from '/imports/lib/collections/riskProperties';
import {asString} from '/imports/lib/security/sanitizeQuery';
import {buildRiskListSelector} from './listQuery';


const find = async function (params) {
  const user = await Meteor.userAsync();
  // Authenticated client calls are scoped to their own company; only trusted
  // server-side calls (no DDP user) may supply a companyId.
  const companyId = user ? (user.profile && user.profile.companyId) : params.companyId;
  if (!companyId) {
    throw new Meteor.Error(403, 'Access Denied');
  }
  params.moduleId = asString(params.moduleId);
  params.projectId = asString(params.projectId);
  params.name = asString(params.name);

  // The projectId branch needs the project's module ids so a single $or query
  // can reach risks stored module-scoped (shapes 2 & 3). Resolve them up front;
  // unused by the moduleId branch. The moduleId branch (which also serves the
  // UI both-set call) is intentionally moduleId-scoped - see listQuery.js.
  let projectModuleIds;
  if (!params.moduleId && params.projectId) {
    const modules = await Modules.find({companyId, projectId: params.projectId}, {fields: {_id: true}}).fetchAsync();
    projectModuleIds = modules.map(m => m._id);
  }

  const selector = buildRiskListSelector({
    companyId,
    moduleId: params.moduleId,
    projectId: params.projectId,
    name: params.name
  }, projectModuleIds);
  if (!selector) {
    return [];
  }

  const list = await RiskProperties.find(selector, params.options || {}).fetchAsync();
  // In the projectId branch, rows carrying a moduleId are module-scoped items;
  // flag them so consumers can distinguish them (matches prior behaviour). The
  // single $or query already guarantees de-dup, so no concat is needed.
  if (params.projectId && !params.moduleId) {
    list.forEach(r => { if (r.moduleId) r.moduleItem = true; });
  }
  return list;
};

export default find;
